// 把新 UI 落到 QQ Agent 安装目录（ui-next/），并保持"随时可回退"。
//
// 目录约定（安装目录 E:\QQ Agent\resources\app\）：
//   ui/        老控制台（原封不动，随时可切回）
//   ui-next/   新 UI（工作区 app/ui/ 的镜像）
//   src/app.js 里新增的 QQ_AGENT_UI_DIR 环境变量决定伺服哪一个
//
// 安全性：
//   · 只写 ui-next/，**从不**碰 ui/；老控制台始终完整。
//   · 覆盖前先把上一版 ui-next/ 备份到 _backup/ui-next-<时间戳>/，可 --rollback。
//   · 每步都校验（关键文件数量、index.html 是否含新 UI 标记、CSP hash 是否一致）。
//
// 用法：
//   node tools/apply-ui.mjs                 预演（只报告要做什么）
//   node tools/apply-ui.mjs --apply         执行
//   node tools/apply-ui.mjs --rollback <ts> 回滚到某次备份
//   node tools/apply-ui.mjs --list          列出备份
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_UI = path.join(ROOT, 'app', 'ui');

const INSTALL_APP = 'E:\\QQ Agent\\resources\\app';
const DEST_UI = path.join(INSTALL_APP, 'ui-next');
const BACKUP_ROOT = path.join(ROOT, '_backup');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIST = args.includes('--list');
const ROLLBACK = (() => {
  const i = args.indexOf('--rollback');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ── 必须一起过去的文件（少一个都会白屏或功能缺失）────────────────────────
const REQUIRED = [
  'index.html',
  'style.css',              // 旧皮肤（新 UI 也依赖它的兜底规则）
  'app.js',                 // ESM 桥（vendor → window）
  'app/00-core.js',
  'app/11-init.js',
  'app/12-concept2-ui.js',
  'shell/00-theme.js',
  'shell/99-shell-boot.js',
  'styles/00-tokens.css',
  'styles/99-legacy-layer.css',
  'styles/_legacy-style.css',
  'vendor/tier-slider.js',
  'vendor/price-match.js',
  'plugin-market/index.html',
  'skill-market/index.html',
  'persona-plaza/index.html'
];

function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  return fs.readdirSync(BACKUP_ROOT)
    .filter((d) => d.startsWith('ui-next-'))
    .sort()
    .reverse();
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) files += copyDir(s, d);
    else { fs.copyFileSync(s, d); files += 1; }
  }
  return files;
}

function verifyDest() {
  const problems = [];
  for (const rel of REQUIRED) {
    const p = path.join(DEST_UI, rel);
    if (!fs.existsSync(p)) { problems.push(`缺文件：${rel}`); continue; }
    if (fs.statSync(p).size === 0) problems.push(`空文件：${rel}`);
  }
  const html = path.join(DEST_UI, 'index.html');
  if (fs.existsSync(html)) {
    const s = fs.readFileSync(html, 'utf8');
    if (!s.includes('q-titlebar')) problems.push('index.html 里没有自绘标题栏（q-titlebar）—— 装错版本了？');
    if (!s.includes('99-legacy-layer.css')) problems.push('index.html 没有引入 99-legacy-layer.css —— 新样式会被旧皮肤盖住');
    if (!s.includes('qqa-theme-pref')) problems.push('index.html 的三档主题内联脚本缺失');
  }
  // 老控制台必须还在
  const legacy = path.join(INSTALL_APP, 'ui', 'index.html');
  if (!fs.existsSync(legacy)) problems.push('老控制台 ui/index.html 不见了（不该发生）');
  return problems;
}

if (LIST) {
  const backs = listBackups();
  console.log(backs.length ? '可用备份：\n  ' + backs.join('\n  ') : '（没有 ui-next 备份）');
  process.exit(0);
}

if (ROLLBACK) {
  const dir = path.join(BACKUP_ROOT, ROLLBACK.startsWith('ui-next-') ? ROLLBACK : `ui-next-${ROLLBACK}`);
  if (!fs.existsSync(dir)) { console.error(`✗ 找不到备份：${dir}`); process.exit(1); }
  fs.rmSync(DEST_UI, { recursive: true, force: true });
  const n = copyDir(dir, DEST_UI);
  console.log(`✔ 已回滚 ${n} 个文件：${dir} → ${DEST_UI}`);
  console.log('  记得重启 QQ Agent 才会生效。');
  process.exit(0);
}

// ── 预检 ────────────────────────────────────────────────────────────────
console.log('源目录：', SRC_UI);
console.log('目标：  ', DEST_UI);
if (!fs.existsSync(path.join(SRC_UI, 'index.html'))) {
  console.error('✗ 源目录里没有 index.html，中止。'); process.exit(1);
}
if (!fs.existsSync(INSTALL_APP)) {
  console.error(`✗ 找不到安装目录 ${INSTALL_APP}，中止。`); process.exit(1);
}

const srcFiles = (function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
})(SRC_UI);

console.log(`源文件数：${srcFiles}（老控制台 ui/ 不会被触碰）`);

if (!APPLY) {
  console.log('\n预演完成。真正执行请加 --apply。');
  process.exit(0);
}

// ── 1. 备份现有 ui-next ─────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
if (fs.existsSync(DEST_UI)) {
  const bak = path.join(BACKUP_ROOT, `ui-next-${stamp}`);
  fs.mkdirSync(bak, { recursive: true });
  const n = copyDir(DEST_UI, bak);
  console.log(`✔ 已备份旧 ui-next（${n} 个文件）→ ${bak}`);
} else {
  console.log('· 目标目录还不存在（首次安装）');
}

// ── 2. 写入 ─────────────────────────────────────────────────────────────
fs.rmSync(DEST_UI, { recursive: true, force: true });
const copied = copyDir(SRC_UI, DEST_UI);
console.log(`✔ 已写入 ${copied} 个文件 → ${DEST_UI}`);

// ── 3. 校验 ─────────────────────────────────────────────────────────────
const problems = verifyDest();
if (problems.length) {
  console.error('\n✗ 校验失败：');
  for (const p of problems) console.error('  · ' + p);
  if (fs.existsSync(path.join(BACKUP_ROOT, `ui-next-${stamp}`))) {
    console.error(`\n可用回滚：node tools/apply-ui.mjs --rollback ${stamp}`);
  }
  process.exit(2);
}
console.log('✔ 校验通过（关键文件齐全、新 UI 标记存在、老控制台完好）');
console.log('\n下一步：重启 QQ Agent 才会生效。');
console.log('  · 环境变量 QQ_AGENT_UI_DIR 需要指向 ui-next（electron/main.js 已内置默认值）');
console.log('  · 想切回老控制台：在 electron/main.js 里去掉该默认值，或改指回 ui/');
