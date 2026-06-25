#!/usr/bin/env node
// Local dev server — serves /public as static + /api/* as serverless-compatible handlers.
// Usage: node --env-file=.env.local scripts/dev.js [port]
// Requires Node 20+ (--env-file flag, ESM dynamic import, built-in fetch)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.argv[2]) || 3333;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Read request body as JSON (or null)
function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(null);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// Minimal res wrapper — mirrors Vercel's req/res interface
function makeRes(nativeRes) {
  let statusCode = 200;
  const headers = {};
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(s) { statusCode = s; return res; },
    json(body) {
      nativeRes.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
      nativeRes.end(JSON.stringify(body));
    },
    send(body) {
      nativeRes.writeHead(statusCode, headers);
      nativeRes.end(body);
    },
  };
  return res;
}

// Import cache — Node ESM caches by URL; restart server to pick up file changes.
const handlerCache = new Map();
async function loadHandler(name) {
  if (!handlerCache.has(name)) {
    const filePath = path.join(ROOT, 'api', name + '.js');
    const mod = await import(pathToFileURL(filePath).href);
    handlerCache.set(name, mod.default);
  }
  return handlerCache.get(name);
}

const server = http.createServer(async (req, nativeRes) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── API routes ──────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice('/api/'.length).replace(/\/$/, '');
    const apiFile = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(apiFile)) {
      nativeRes.writeHead(404, { 'Content-Type': 'application/json' });
      nativeRes.end(JSON.stringify({ error: 'api-not-found', path: pathname }));
      return;
    }
    try {
      const handler = await loadHandler(name);
      const body = await readBody(req);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
      const augReq = Object.assign(req, { body, headers });
      await handler(augReq, makeRes(nativeRes));
    } catch (e) {
      if (!nativeRes.headersSent) {
        nativeRes.writeHead(500, { 'Content-Type': 'application/json' });
        nativeRes.end(JSON.stringify({ error: 'internal', message: String(e?.message || e).slice(0, 300) }));
      }
    }
    return;
  }

  // ── Static files ─────────────────────────────────────────────────
  let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  // fallback: try adding .html
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    const withHtml = filePath + '.html';
    if (fs.existsSync(withHtml)) filePath = withHtml;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    nativeRes.writeHead(404, { 'Content-Type': 'text/plain' });
    nativeRes.end(`404 — ${pathname}`);
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  nativeRes.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(nativeRes);
});

server.listen(PORT, () => {
  console.log(`\n✓ Dev server: http://localhost:${PORT}/operator.html`);
  console.log(`  API: http://localhost:${PORT}/api/auth-check`);
  console.log(`  .env.local loaded via --env-file flag\n`);
});
