// POST /api/lead — operator-only.
// Body: { domain, clinicName, contactName, phone, email?, selectedProducts[], notes?, geoScore, aiCited }
// Stores to Upstash KV (backup) + Notion (primary DB for meeting scheduling).
// Graceful degradation: if NOTION_TOKEN/NOTION_LEADS_DB_ID missing → KV only.
import { kv } from '../lib/kv.js';

const NOTION_API = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';
const TTL_90D = 7_776_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  // Operator gate (same pattern as citation.js)
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  const isOperator = operatorKeySet && req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (operatorKeySet && !isOperator) {
    res.status(401).json({ error: 'operator-key-required', message: '운영자 키가 필요합니다.' });
    return;
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
  res.status(200).json({ ok: true, leadId, notionOk, notionSkipped: !notionToken || !notionDbId });
}
