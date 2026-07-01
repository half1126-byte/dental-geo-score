// Discord webhook alert — zero dependency, completely free.
// Set DISCORD_WEBHOOK_URL in Vercel env to enable. Silent if not set.
export async function sendAlert(message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message, username: 'dental-geo-score' }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.error('[alert] discord failed:', e.message));
}
