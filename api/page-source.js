// POST /api/page-source { url } — operator-only.
// Fetches a URL (SSRF-safe) and returns sanitized HTML sections for side-by-side comparison:
// title, key meta tags, canonical, JSON-LD blocks, body text snippet.
import { safeFetch, FetchBlockedError } from '../lib/fetcher.js';

export const config = { runtime: 'nodejs', maxDuration: 12 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  // Operator gate
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  const isOperator = operatorKeySet && req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (operatorKeySet && !isOperator) {
    res.status(401).json({ error: 'operator-key-required' });
    return;
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'missing-url' });
    return;
  }

  try {
    const page = await safeFetch(url, { timeoutMs: 8000, maxBytes: 1_500_000 });
    const html = page.body || '';

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';

    // Canonical
    const canonMatch = html.match(/<link[^>]+rel=['"]canonical['"][^>]+href=['"]([^'"]+)['"]/i)
      || html.match(/<link[^>]+href=['"]([^'"]+)['"][^>]+rel=['"]canonical['"]/i);
    const canonical = canonMatch ? canonMatch[1].trim().slice(0, 300) : '';

    // Relevant meta tags (description, og:*, twitter:*, robots)
    const metas = [];
    const metaRe = /<meta\s[^>]+>/gi;
    let m;
    while ((m = metaRe.exec(html)) !== null && metas.length < 15) {
      const tag = m[0];
      if (/(name=["'](description|keywords|robots|author)|property=["'](og:|twitter:))/i.test(tag)) {
        metas.push(tag.replace(/\s+/g, ' ').trim().slice(0, 300));
      }
    }

    // JSON-LD blocks (full content, sliced to keep response reasonable)
    const jsonlds = [];
    const jldRe = /<script[^>]+type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = jldRe.exec(html)) !== null && jsonlds.length < 5) {
      try {
        const parsed = JSON.parse(m[1]);
        jsonlds.push(JSON.stringify(parsed, null, 2).slice(0, 1200));
      } catch {
        jsonlds.push(m[1].trim().slice(0, 1200));
      }
    }

    // Body visible text (strip scripts/styles/tags)
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    res.status(200).json({ title, canonical, metas, jsonlds, bodyText, finalUrl: page.finalUrl });
  } catch (e) {
    if (e instanceof FetchBlockedError) {
      res.status(422).json({ error: 'fetch-blocked', reason: e.reason, detail: e.detail || null });
      return;
    }
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
