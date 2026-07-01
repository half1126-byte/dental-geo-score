// Slack incoming webhook alert — zero dependency, completely free.
// Set SLACK_WEBHOOK_URL in Vercel env to enable. Silent if not set.
export async function sendAlert(message) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.error('[alert] slack failed:', e.message));
}
