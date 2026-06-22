// SSRF-hardened fetcher. Every fetch of a user-supplied URL goes through here.
// Defenses: scheme allowlist, port allowlist, DNS resolution + IP validation of EVERY
// resolved address, connection PINNED to the validated IP via the node core `lookup`
// option (defeats DNS rebinding), manual redirect handling with per-hop re-validation,
// hard timeout, body-size cap. Uses node:http/https (stable lookup contract).
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isBlockedIp } from './ip-guard.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443]); // empty (default) also allowed; see validateUrl
const DEFAULTS = {
  maxRedirects: 4,
  maxBytes: 3 * 1024 * 1024, // 3 MB
  timeoutMs: 8000,
  userAgent:
    'DentalGEOScoreBot/0.1 (+https://dental-geo-score.example; AI citation readiness audit)',
};

export class FetchBlockedError extends Error {
  constructor(reason, detail) {
    super(`fetch blocked: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'FetchBlockedError';
    this.reason = reason;
    this.detail = detail;
  }
}

export function validateUrl(input, base) {
  let url;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    throw new FetchBlockedError('invalid-url', String(input).slice(0, 120));
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new FetchBlockedError('bad-scheme', url.protocol);
  if (url.port !== '' && !ALLOWED_PORTS.has(Number(url.port))) throw new FetchBlockedError('bad-port', url.port);
  if (url.username || url.password) throw new FetchBlockedError('userinfo-not-allowed');
  return url;
}

// Resolve hostname, reject if ANY resolved address is blocked, return the address to pin to.
async function resolvePinned(hostname) {
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new FetchBlockedError('dns-failed', hostname);
  }
  if (!records.length) throw new FetchBlockedError('dns-empty', hostname);
  for (const r of records) {
    const chk = isBlockedIp(r.address);
    if (chk.blocked) throw new FetchBlockedError('blocked-ip', `${hostname} -> ${r.address} [${chk.reason}]`);
  }
  return records[0]; // {address, family}
}

function readCapped(res, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    res.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        res.destroy();
        reject(new FetchBlockedError('body-too-large', `>${maxBytes}`));
      } else {
        chunks.push(c);
      }
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', (e) => reject(new FetchBlockedError('read-failed', String(e?.message || e))));
  });
}

function requestOnce(url, pinned, opts) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    // Pin DNS to the pre-validated IP. net.connect calls this; rebinding can't swap it.
    // Node may call with { all: true } (expects array) or legacy (address, family).
    const lookup = (host, a, b) => {
      const dnsopts = typeof a === 'function' ? {} : a || {};
      const cb = typeof a === 'function' ? a : b;
      if (dnsopts.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
      else cb(null, pinned.address, pinned.family);
    };
    const reqOpts = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: (url.pathname || '/') + (url.search || ''),
      method: 'GET',
      lookup,
      servername: isHttps ? url.hostname : undefined, // SNI
      headers: {
        host: url.host,
        'user-agent': opts.userAgent,
        accept: 'text/html,application/xhtml+xml,text/plain,*/*;q=0.8',
        'accept-language': 'ko,en;q=0.8',
      },
    };
    const req = mod.request(reqOpts, (res) => resolve(res));
    req.setTimeout(opts.timeoutMs, () => req.destroy(new FetchBlockedError('timeout', `${opts.timeoutMs}ms`)));
    req.on('error', (e) =>
      reject(e instanceof FetchBlockedError ? e : new FetchBlockedError('connect-failed', String(e?.message || e).slice(0, 160)))
    );
    req.end();
  });
}

/**
 * Fetch a user-supplied URL safely.
 * @returns {{status:number, contentType:string, body:string, finalUrl:string, ip:string, redirectChain:string[]}}
 */
export async function safeFetch(input, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let url = validateUrl(input);
  const chain = [url.href];

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const pinned = await resolvePinned(url.hostname);
    const res = await requestOnce(url, pinned, opts);
    const status = res.statusCode;
    const headers = res.headers;
    const location = headers['location'];

    if (status >= 300 && status < 400 && location) {
      res.resume(); // drain & discard
      if (hop === opts.maxRedirects) throw new FetchBlockedError('too-many-redirects', String(hop));
      url = validateUrl(location, url.href); // re-validate scheme/port on every hop
      chain.push(url.href);
      continue;
    }

    const contentType = String(headers['content-type'] || '');
    const body = await readCapped(res, opts.maxBytes);
    return { status, contentType, body, finalUrl: url.href, ip: pinned.address, redirectChain: chain };
  }
  throw new FetchBlockedError('too-many-redirects', String(opts.maxRedirects));
}
