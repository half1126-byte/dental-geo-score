import { createHmac, timingSafeEqual } from 'node:crypto';

export const OPERATOR_COOKIE = 'medinmedi_operator_session';
export const OPERATOR_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionSecret() {
  // A dedicated secret is preferred. OPERATOR_KEY remains a backwards-compatible
  // fallback so existing deployments can migrate without an outage.
  return process.env.OPERATOR_SESSION_SECRET || process.env.OPERATOR_KEY || '';
}

function signature(payload, secret = sessionSecret()) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function verifyOperatorPassword(password) {
  const expected = process.env.ADVANCED_GATE_PASSWORD || '';
  return !!expected && typeof password === 'string' && safeEqual(password, expected);
}

export function createOperatorSession({ now = Date.now(), ttlMs = OPERATOR_SESSION_TTL_MS } = {}) {
  const secret = sessionSecret();
  if (!secret) return null;
  const expiresAt = now + Math.max(60_000, Number(ttlMs) || OPERATOR_SESSION_TTL_MS);
  const payload = `v1.${expiresAt}`;
  return { token: `${payload}.${signature(payload, secret)}`, expiresAt };
}

export function verifyOperatorSession(token, { now = Date.now() } = {}) {
  const secret = sessionSecret();
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], signature(payload, secret));
}

function cookieValue(req, name) {
  const raw = String(req?.headers?.cookie || req?.headers?.Cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

export function isOperatorRequest(req) {
  const configuredKey = process.env.OPERATOR_KEY || '';
  if (!configuredKey) return false; // fail closed on a missing production secret

  // Retain server-to-server/CLI compatibility. The browser UI no longer receives
  // or stores this key; it authenticates only with the HttpOnly session cookie.
  const headerKey = req?.headers?.['x-operator-key'];
  if (typeof headerKey === 'string' && safeEqual(headerKey, configuredKey)) return true;

  return verifyOperatorSession(cookieValue(req, OPERATOR_COOKIE));
}

function isSecureRequest(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwarded === 'https' || process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

export function setOperatorSessionCookie(req, res, session) {
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${OPERATOR_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

export function clearOperatorSessionCookie(req, res) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${OPERATOR_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

