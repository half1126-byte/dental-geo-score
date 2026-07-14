// POST /api/lead — operator-only, plus public naver-ai lead-gen mode.
// Operator body: { domain, clinicName, contactName, phone, email?, selectedProducts[], notes?, geoScore, aiCited }
// Public body (source:'naver-ai'): { source, clinicName, email, phone?, notes? } — IP rate-limited.
// Stores to Upstash KV (backup) + Notion (primary DB for meeting scheduling).
// Graceful degradation: if NOTION_TOKEN/NOTION_LEADS_DB_ID missing → KV only.
import { kv } from '../lib/kv.js';
import { sendAlert } from '../lib/alert.js';
import { isOperatorRequest } from '../lib/operator-auth.js';

const NOTION_API = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';
const TTL_90D = 7_776_000;
const PUBLIC_RATE_LIMIT = 5; // 시간당 IP별 최대 제출 (naver-ai 공개 폼)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  const isPublicNaverAi = req.body && req.body.source === 'naver-ai';

  // Operator gate (same pattern as citation.js) — naver-ai 공개 폼만 예외 (아래 별도 검증+레이트리밋)
  if (!isPublicNaverAi && !isOperatorRequest(req)) {
    res.status(401).json({ error: 'operator-key-required', message: '운영자 키가 필요합니다.' });
    return;
  }

  if (isPublicNaverAi) {
    // 스팸 방지 — IP당 시간당 5회 (kv 미설정이면 통과: 폼 자체가 저노출이라 수용)
    if (kv) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const rlKey = `nvlead:rl:${ip}`;
      try {
        const count = await kv.incr(rlKey);
        if (count === 1) await kv.expire(rlKey, 3600);
        if (count > PUBLIC_RATE_LIMIT) {
          res.status(429).json({ error: 'rate-limited', message: '잠시 후 다시 시도해주세요.' });
          return;
        }
      } catch (_) { /* rate-limit 실패는 non-blocking */ }
    }
    const { clinicName, email } = req.body || {};
    if (!clinicName || typeof clinicName !== 'string' || !clinicName.trim()) {
      res.status(400).json({ error: 'missing-clinicName' });
      return;
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'invalid-email' });
      return;
    }
    // 공개 폼 필드를 operator 스키마로 정규화해 아래 공통 저장 로직 재사용
    req.body = {
      domain: '',
      clinicName: req.body.clinicName,
      contactName: '(네이버AI 리드젠)',
      phone: String(req.body.phone || '').trim() || '-',
      email: req.body.email,
      selectedProducts: ['네이버AI 토탈 패키지 문의'],
      notes: `[naver-ai.html 공개 폼] ${String(req.body.notes || '').trim()}`.trim(),
      geoScore: null,
      aiCited: false,
    };
  }

  const { domain, clinicName, contactName, phone, email, selectedProducts, notes, geoScore, aiCited } = req.body || {};

  if (!clinicName || typeof clinicName !== 'string' || !clinicName.trim()) {
    res.status(400).json({ error: 'missing-clinicName' });
    return;
  }
  if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
    res.status(400).json({ error: 'missing-contactName' });
    return;
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    res.status(400).json({ error: 'missing-phone' });
    return;
  }
  if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
    res.status(400).json({ error: 'missing-selectedProducts' });
    return;
  }

  const ts = new Date().toISOString();
  const leadId = `lead:${ts}:${(domain || 'unknown').slice(0, 60)}`;

  const leadData = {
    domain: String(domain || '').slice(0, 200),
    clinicName: clinicName.trim().slice(0, 100),
    contactName: contactName.trim().slice(0, 100),
    phone: phone.trim().slice(0, 30),
    email: String(email || '').trim().slice(0, 200),
    selectedProducts: selectedProducts.slice(0, 10).map((p) => String(p).slice(0, 100)),
    notes: String(notes || '').trim().slice(0, 1000),
    geoScore: typeof geoScore === 'number' ? geoScore : null,
    aiCited: !!aiCited,
    submittedAt: ts,
    status: '신규',
  };

  // 1. KV backup (non-blocking)
  if (kv) {
    await kv.set(leadId, JSON.stringify(leadData), TTL_90D).catch(() => {});
  }

  // 2. Notion HTTP API
  let notionOk = false;
  const notionToken = process.env.NOTION_TOKEN;
  const notionDbId = process.env.NOTION_LEADS_DB_ID;

  if (notionToken && notionDbId) {
    try {
      const notionBody = {
        parent: { database_id: notionDbId },
        properties: {
          '도메인':    { title: [{ text: { content: leadData.domain || '(없음)' } }] },
          '치과명':    { rich_text: [{ text: { content: leadData.clinicName } }] },
          '담당자':    { rich_text: [{ text: { content: leadData.contactName } }] },
          '연락처':    { phone_number: leadData.phone },
          '이메일':    { email: leadData.email || null },
          '선택 상품': { multi_select: leadData.selectedProducts.map((name) => ({ name })) },
          '메모':      { rich_text: [{ text: { content: leadData.notes || '' } }] },
          '상태':      { select: { name: '신규' } },
          '제출 시각': { date: { start: ts } },
          'AI 인용':   { select: { name: leadData.aiCited ? '인용됨' : '미인용' } },
          ...(leadData.geoScore !== null ? { 'GEO 점수': { number: leadData.geoScore } } : {}),
        },
      };
      const nr = await fetch(NOTION_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionToken}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notionBody),
        signal: AbortSignal.timeout(10000),
      });
      notionOk = nr.ok;
      if (!nr.ok) {
        const errText = await nr.text().catch(() => '');
        console.error('[lead] Notion error', nr.status, errText.slice(0, 200));
      }
    } catch (e) {
      console.error('[lead] Notion exception', String(e?.message || e).slice(0, 200));
    }
  }

  console.log('[lead]', leadData.domain, leadData.clinicName, leadData.selectedProducts.join(','), notionOk ? 'Notion:ok' : 'Notion:skip');
  sendAlert(`🏥 **새 거래처 리드**\n${leadData.clinicName} | ${leadData.contactName} | ${leadData.phone}\n상품: ${leadData.selectedProducts.join(', ')}\nGEO: ${leadData.geoScore ?? '-'} | AI인용: ${leadData.aiCited ? '있음' : '없음'}`).catch(() => {});
  res.status(200).json({ ok: true, leadId, notionOk, notionSkipped: !notionToken || !notionDbId });
}
