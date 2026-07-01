// POST /api/naver-place
// Operator-only: returns Naver Place public stats for competitive analysis.
// Requires x-operator-key header. Never reaches public view (competitor data).

import { getNaverPlaceData } from '../lib/naver-place.js';
import { sendAlert } from '../lib/alert.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Operator gate — primary security boundary; no further rate cap needed for operator path
  const key = req.headers['x-operator-key'] || '';
  if (!key || key !== process.env.OPERATOR_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { region, procedure, clinicPhone, clinicName } = req.body || {};

  if (!region || !procedure) {
    return res.status(400).json({ error: 'bad_request', message: 'region and procedure required' });
  }

  const query = `${region} ${procedure} 치과`.replace(/\s+/g, ' ').trim();

  try {
    const result = await getNaverPlaceData({ query, clinicPhone, clinicName });
    return res.status(200).json(result);
  } catch (err) {
    // Graceful failure: log but return structured empty result
    console.error('[naver-place] error:', err.message);
    sendAlert(`⚠️ **Naver GraphQL 오류** (스키마 변경 가능성)\n쿼리: ${query}\n오류: ${err.message.slice(0, 120)}`).catch(() => {});
    return res.status(502).json({
      query,
      total: null,
      target: null,
      competitors: [],
      parsedAt: new Date().toISOString(),
      dataNote: '플레이스 데이터 조회 실패: ' + err.message.slice(0, 80),
      error: 'fetch_failed',
    });
  }
}
