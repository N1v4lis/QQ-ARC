// 新 UI 开发服务器（零侵入）。
//
// 为什么需要它：现有 QQ Agent 正在运行（Electron 窗口 + :3210 的 HTTP 服务），
// 改它的 ui/ 会直接影响用户正在用的界面 —— 违背「不影响现有运行」。
// 所以新 UI 从**工作区目录**静态伺服，所有 /api/* 转发到正在跑的 :3210，
// 于是新界面拿到的是真实数据，而被改动的只有工作区文件。
//
// 用法：node tools/dev-server.mjs [--port 3400] [--ui <dir>] [--api http://127.0.0.1:3210]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', 3400));
const UI_DIR = path.resolve(arg('ui', path.join(ROOT, 'app', 'ui')));
const API_TARGET = arg('api', 'http://127.0.0.1:3210');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  // Minecraft 主题素材（见 assets/mc/）：
  //   .ttf  → 打包的 MC 字体（@font-face 会按 MIME 决定是否接受，写错就是不生效）
  //   .wav  → 合成出来的互动音效（WebAudio 的 decodeAudioData 不看 MIME，
  //            但写对了才便于排查/直接播放）
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

// 与线上 app.js:1624-1638 完全同款的 CSP（两份都放行，浏览器取交集）。
// 本服务器同时提供 HTTP 头 + 由 index.html 的 meta 声明，保持与生产一致 ——
// 否则「本地能跑线上闪白」这类差异会拖到最后才暴露。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-o6zN5A75fvKFN09qXICy4g0x1aA/qHMybnUt8jhbYUc=' 'sha256-XDNUFW0To+No3pNwG2FPwZhtxxokhL/M/FnLydwuVRs=' https://o.alicdn.com https://kondius.cn",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://kondius.cn https://*.aliyuncs.com https://*.alicdn.com",
  "frame-src https://*.aliyuncs.com https://*.alicdn.com https://kondius.cn",
  "worker-src 'self' blob: https://*.alicdn.com https://kondius.cn",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'" ].join('; ');

const apiTarget = new URL(API_TARGET);

function proxy(req, res) {
  // ⚠️ 必须把 Origin / Referer 改写成上游自己的源（2026-10-04 修）。
  //   上游 app.js 有 originAllowed()：它要求 `Origin 的 host === 请求的 Host`，
  //   否则回 403 —— 这是防"恶意网页借浏览器打 127.0.0.1"的 CSRF 防线，不能关。
  //   而本开发服务器把页面放在 :3400、API 代理到 :3210：
  //   浏览器发出的 Origin 是 http://127.0.0.1:3400，转发时 Host 变成 127.0.0.1:3210，
  //   两者不等 → **每个** API 都 403。
  //   症状很容易误判：静态资源同源、页面能正常渲染，但部分接口
  //   （/api/prompt-preview、/api/config…）报 403，看起来像"新 UI 把设置页搞坏了"。
  //   实测确认：在真实控制台（同源 :3210）上这些接口全是 200。
  //   所以这里改写来源头，让本地验证环境与生产**同源等价**，不再产生假故障。
  const headers = { ...req.headers, host: apiTarget.host };
  if (headers.origin) headers.origin = `http://${apiTarget.host}`;
  if (headers.referer) {
    try { headers.referer = `http://${apiTarget.host}${new URL(headers.referer).pathname}`; }
    catch { headers.referer = `http://${apiTarget.host}/`; }
  }
  const options = {
    hostname: apiTarget.hostname,
    port: apiTarget.port || 80,
    path: req.url,
    method: req.method,
    headers
  };
  const up = http.request(options, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.on('error', () => res.destroy());
    upRes.pipe(res);
  });
  up.on('error', (error) => {
    // An SSE proxy already sent HTTP 200 when the host restarts. Sending another
    // status line crashes the whole dev server with ERR_HTTP_HEADERS_SENT.
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`上游 ${API_TARGET} 不可达：${error?.message ?? error}\n（QQ Agent 没在跑？先启动它再刷新）`);
  });
  req.on('aborted', () => up.destroy());
  res.on('close', () => up.destroy());
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* keep / */ }

  if (pathname.startsWith('/api/') || pathname === '/api') return proxy(req, res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }

  let decoded;
  try { decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }

  const segs = decoded.replace(/^([/\\])+/, '').split(/[/\\]+/);
  const clean = [];
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || /[\x00-\x1f]/.test(seg)) { res.writeHead(403); res.end('Forbidden'); return; }
    clean.push(seg);
  }
  if (!clean.length) { res.writeHead(403); res.end('Forbidden'); return; }

  const full = path.join(UI_DIR, ...clean);
  const rel = path.relative(UI_DIR, full);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  let data;
  try { data = fs.readFileSync(full); }
  catch {
    // 单页应用式兜底：无扩展名的路径回落到 index.html（新壳里用 pushState 路由时有用）
    if (!path.extname(full)) {
      try { data = fs.readFileSync(path.join(UI_DIR, 'index.html')); }
      catch { res.writeHead(404); res.end('Not Found'); return; }
    } else { res.writeHead(404); res.end('Not Found'); return; }
  }

  const ext = path.extname(full);
  const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
  if (ext === '.html') {
    headers['content-security-policy'] = CSP;
    headers['x-content-type-options'] = 'nosniff';
    headers['referrer-policy'] = 'no-referrer';
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-server] UI   = ${UI_DIR}`);
  console.log(`[dev-server] API  → ${API_TARGET}`);
  console.log(`[dev-server] 打开  http://127.0.0.1:${PORT}/`);
});
