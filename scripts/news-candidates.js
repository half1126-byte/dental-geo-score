// Optional operator helper — prints candidate AI-search items from whitelist RSS to the console.
// It does NOT publish: you read these, pick a few, hand-write summary/clientAction, and edit
// public/data/fieldnotes.json yourself. Human-in-the-loop by design.
//
//   node scripts/news-candidates.js            # all feeds
//   NODE_OPTIONS=--use-system-ca node scripts/news-candidates.js   # behind Avast/MITM
//
// Feed URLs drift over time — a 404 just skips that source (best-effort, never throws).
import * as cheerio from 'cheerio';

const FEEDS = [
  ['Google Search Central', 'https://developers.google.com/search/blog/feed.xml'],
  ['OpenAI', 'https://openai.com/news/rss.xml'],
  ['Search Engine Land', 'https://searchengineland.com/feed'],
  ['Search Engine Journal', 'https://www.searchenginejournal.com/feed/'],
  ['Search Engine Roundtable', 'https://www.seroundtable.com/index.rdf'],
];

const KEYWORDS = /ai search|generative engine|geo|aeo|ai overview|sge|chatgpt|perplexity|answer engine|citation|grounding|ai mode|gemini|copilot|llm/i;

function parse(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $('item, entry').each((_, el) => {
    const $el = $(el);
    const title = $el.find('title').first().text().trim();
    let url = $el.find('link').first().attr('href') || $el.find('link').first().text().trim();
    const date = ($el.find('pubDate').first().text() || $el.find('updated').first().text() || '').trim();
    if (title && url) out.push({ title, url, date });
  });
  return out;
}

async function fetchFeed(name, url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'DentalGEOScoreBot/0.1' } });
    if (!r.ok) { console.error(`  ⚠️  ${name}: HTTP ${r.status} — skipped`); return []; }
    const items = parse(await r.text()).filter((it) => KEYWORDS.test(it.title));
    return items.slice(0, 6).map((it) => ({ ...it, source: name }));
  } catch (e) {
    console.error(`  ⚠️  ${name}: ${e.message} — skipped`);
    return [];
  }
}

const results = await Promise.allSettled(FEEDS.map(([n, u]) => fetchFeed(n, u)));
const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

console.log(`\n${items.length} candidate item(s) (AI-search keyword match). Pick, summarize, edit fieldnotes.json:\n`);
for (const it of items) {
  console.log(`• [${it.source}] ${it.title}`);
  console.log(`  ${it.url}${it.date ? `  (${it.date})` : ''}\n`);
}
if (!items.length) console.log('(none — feeds may have moved; check URLs in this script)\n');
