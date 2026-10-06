// ═══════════════════════════════════════════════════════════════════════════
// patch-host-mime.mjs — 给 QQ Agent 的静态服务器补上缺失的 MIME 类型
// ═══════════════════════════════════════════════════════════════════════════
// 为什么需要这个补丁：
//   `src/app.js` 里那张 MIME 表**没有 `.mjs`**，于是 .mjs 落到
//   `application/octet-stream`。浏览器按规范拒绝把非 JavaScript MIME 的模块
//   当页面用 ES 模块动态加载 .mjs，`import('/assets/xxx.mjs')` 会报
//   "Failed to fetch dynamically imported module" ——
//   而 `fetch()` 同一个 URL 却是 200，所以**光看网络面板看不出问题**，
//   非常容易误判成"文件不存在"或"路径写错了"。
//
// 顺带补齐字体与音频的 MIME（.ttf/.woff/.wav）：
//   它们能工作是因为 @font-face 与 decodeAudioData 都比较宽容，
//   但写对了才能让浏览器正确缓存、也便于排查。
//
// 幂等：已经是新版就直接跳过，不会重复改。
// 用法：node tools/patch-host-mime.mjs [app.js 路径]
'use strict';
import fs from 'node:fs';

const FILE = process.argv[2] || 'E:/QQ Agent/resources/app/src/app.js';

if (!fs.existsSync(FILE)) {
  console.log(`⚠ 找不到 ${FILE}，跳过宿主 MIME 补丁。`);
  process.exit(0);
}

const src = fs.readFileSync(FILE, 'utf8');

// 已经包含 .mjs 就认为补过（幂等）
if (src.includes("'.mjs':")) {
  console.log('✔ 宿主 MIME 已包含 .mjs，无需修改。');
  process.exit(0);
}

/** 目标：把 old 那一整行替换为 new；replace 只做一次，避免误伤 */
const OLD = "const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };";
const NEW = "// ⚠️ .mjs：**ES 模块必须用 JavaScript MIME**，否则浏览器按规范拒绝加载\n"
  + "        //    （现象是 import() 报 \"Failed to fetch dynamically imported module\"，\n"
  + "        //     而 fetch() 同一 URL 返回 200 —— 只看网络面板会误判成路径写错）。\n"
  + "        //    新 UI 的界面模块用 import() 动态加载渲染核心，由 tools/patch-host-mime.mjs 维护。\n"
  + "        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav' };";

if (!src.includes(OLD)) {
  console.log('⚠ 宿主 MIME 表与预期不一致（QQ Agent 可能已更新），未做修改。');
  console.log('  请人工检查 src/app.js 里的 const types = { ... } 一行，补上：');
  console.log("    '.mjs': 'text/javascript; charset=utf-8'");
  process.exit(3);
}

// 备份一次（带时间戳），便于回滚
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bak = `${FILE}.bak-foxmime-${stamp}`;
fs.copyFileSync(FILE, bak);
fs.writeFileSync(FILE, src.replace(OLD, NEW));
console.log(`✔ 已给宿主补上 .mjs / .ttf / .woff / .wav 的 MIME 类型。`);
console.log(`  备份：${bak}`);
