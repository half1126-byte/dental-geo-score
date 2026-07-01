// ntfy.sh push alert — zero dependency, completely free, no account needed.
// Set NTFY_TOPIC in Vercel env (e.g. "dental-geo-alert-xyz"). Silent if not set.
export async function sendAlert(message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    body: message,
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.error('[alert] ntfy failed:', e.message));
}
