// CSP 内联脚本 hash 工具。
//
// 背景：app/ui/index.html 里那段"主题预置"必须是内联脚本（外链会晚一帧执行 →
// 首屏闪白），而 CSP 的 script-src 只放行精确的 sha256（不用 'unsafe-inline'，
// 否则页面里任何一处 innerHTML 注入都能直接执行内联代码）。于是这段脚本的 hash
// 变成一个**契约**，几个地方必须一致：
//   · app/ui/index.html 的 <meta http-equiv="Content-Security-Policy">
//   · src/app.js 给 .html 下发的 HTTP 头（工作区 + 安装目录两份）
//   · tools/dev-server.mjs（本地开发用同一份口径）
//
// ⚠️ 哈希对不上时浏览器**只打一条 console 警告**，页面照常显示
// （data-theme 在 HTML 上已有静态默认值），非常容易漏掉 —— 2026-10-03 就因此
// 让"默认跟随系统"静默失效了一整轮。所以：
//   1) 改完内联脚本 → 必须跑 `node tools/csp-hash.mjs --write`
//   2) 改完 → 必须跑 `node tools/check-inline-script.mjs` 做**运行时**验证
//      （它用 CDP 真加载页面，反查内联脚本有没有生效，不靠"hash 看起来对"）
//
// ⚠️ 第二个坑（同一天踩到）：**hash 与换行符相关**。
//   浏览器算 hash 用的是"它收到的字节"。文件在 Windows 上是 CRLF（\r\n），
//   而脚本里读进来算的时候如果按 LF 算，得出来的 hash 永远对不上 ——
//   而且因为第 1 条，失败时毫无提示。所以本工具同时算出 CRLF / LF 两种形态的
//   hash，**两个都写进 allowlist**，并强制把文件写成 CRLF（统一口径，避免
//   "同一个文件在两台机器上 hash 不同"这种玄学问题）。
//
// 用法：
//   node tools/csp-hash.mjs            只检查
//   node tools/csp-hash.mjs --write    写回（并把 index.html 统一成 CRLF）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INDEX = path.join(ROOT, 'app', 'ui', 'index.html');
const APP_JS = [
  path.join(ROOT, 'app', 'src', 'app.js'),
  'E:\\QQ Agent\\resources\\app\\src\\app.js'
].filter((p, i, a) => fs.existsSync(p) && a.indexOf(p) === i);
const DEV_SERVER = path.join(HERE, 'dev-server.mjs');

const WRITE = process.argv.includes('--write');

const html = fs.readFileSync(INDEX, 'utf8');

// ── 1. 归一化换行：统一 CRLF（Windows 上的既有约定） ─────────────────────
function toCrlf(text) { return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'); }

if (WRITE) {
  const normalized = toCrlf(html);
  if (normalized !== html) {
    fs.writeFileSync(INDEX, normalized, 'utf8');
    console.log('· index.html 换行已统一为 CRLF');
  }
}
const htmlFinal = fs.readFileSync(INDEX, 'utf8');

// ── 2. 现算内联脚本的 hash（两种换行形态都给） ───────────────────────────
const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(htmlFinal)) !== null) blocks.push(m[1]);
if (!blocks.length) { console.error('✗ index.html 里没有找到内联脚本'); process.exit(1); }

const hashOf = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
const tokens = [];
for (const body of blocks) {
  const crlf = hashOf(body);                              // 文件里的真实形态
  const lf = hashOf(body.replace(/\r\n/g, '\n'));         // 万一被规范化过
  for (const h of [crlf, lf]) if (!tokens.includes(`sha256-${h}`)) tokens.push(`sha256-${h}`);
}

const SCRIPT_SRC = `script-src 'self' ${tokens.map((t) => `'${t}'`).join(' ')} https://o.alicdn.com https://kondius.cn`;

console.log(`内联脚本块：${blocks.length} 个`);
console.log(`文件换行：${/\r\n/.test(htmlFinal) ? 'CRLF' : 'LF'}`);
for (const t of tokens) console.log(`  ${t}`);
console.log(`\n目标：${SCRIPT_SRC}\n`);

// ── 3. 各 CSP 载体的检查与替换 ───────────────────────────────────────────

/** HTML：只改 <meta http-equiv="Content-Security-Policy" content="…"> 里的 script-src */
function patchHtmlMeta(text) {
  return text.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)("\s*\/?>)/i,
    (whole, head, csp, tail) => head + csp.replace(/script-src[^;]*/, SCRIPT_SRC) + tail
  );
}

/** JS：只改 "script-src …" 那一行字符串字面量（保留行首缩进） */
function patchJsLine(text) {
  return text.replace(/^(\s*)"script-src[^"]*"(,?)\s*$/gm, (whole, indent, comma) => `${indent}"${SCRIPT_SRC}"${comma}`);
}

function readCarrier(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) {
    const mm = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(src);
    return { src, csp: mm ? mm[1] : '', patch: patchHtmlMeta };
  }
  const line = /^\s*"script-src[^"]*"/m.exec(src);
  return { src, csp: line ? line[0].trim() : '', patch: patchJsLine };
}

function handle(file, label) {
  if (!fs.existsSync(file)) { console.log(`[${label}] 跳过（不存在）：${file}`); return true; }
  const { src, csp, patch } = readCarrier(file);
  // 判定：script-src 里必须含**全部**已知形态的 hash（宁可多放行一个同内容的 hash，
  // 也不要因为换行差异导致内联脚本被拦 —— 拦掉的后果是首屏主题静默失效）
  const ok = tokens.every((t) => csp.includes(`'${t}'`));
  console.log(`[${label}] ${ok ? '✔ 一致' : '✗ 不一致'}`);
  if (!ok && !WRITE) console.log(`   现在：${csp || '(没找到 script-src)'}`);
  if (ok || !WRITE) return ok;

  // 顺序：先把文件里其它位置的 hash（注释里的示例值）替换掉，再 patch 真正的载体。
  // patch 是幂等的，重复执行安全。
  let next = src;
  const known = new Set(tokens);
  const staleHashes = [...new Set((src.match(/sha256-[A-Za-z0-9+/=]{20,}/g) || []))].filter((h) => !known.has(h));
  for (const old of staleHashes) next = next.split(old).join(tokens[0]);
  next = patch(next);
  if (next !== src) { fs.writeFileSync(file, next, 'utf8'); console.log('   ✔ 已写回'); }
  else console.log('   · 无需改动');
  return true;
}

const results = [
  handle(INDEX, 'index.html meta'),
  ...APP_JS.map((p) => handle(p, 'app.js')),
  handle(DEV_SERVER, 'dev-server.mjs')
];

if (!WRITE) {
  if (results.every(Boolean)) console.log('\n全部一致。');
  else { console.log('\n有不一致的地方，跑 `node tools/csp-hash.mjs --write` 修。'); process.exit(2); }
}
