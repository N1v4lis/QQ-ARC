// ═══════════════════════════════════════════════════════════════════════════
// probe-plugin-inject.mjs — 主题插件（theme-mode）的注入是否会被 apply-ui 冲掉
// ═══════════════════════════════════════════════════════════════════════════
// 背景：`plugins/theme-mode` 会往**当前被伺服的** index.html 里注入
//   `<script defer src="/theme-switcher.js"></script>`（可能还有 theme-elysia.js）。
// 而 `tools/apply-ui.mjs --apply` 是**整目录用工作区镜像覆盖** ——
// 工作区的 index.html **没有**这些注入行，所以部署会把它们冲掉。
//
// 这是移交的一个真实缺口：接手方如果不知道这件事，会看到
//   "部署后主题切换按钮消失"，而且不知道该怪谁。
//
// 本脚本只做**只读观测**：比对部署目录的 index.html 与插件期望的注入行，
// 并报告插件的自检/注入节奏（从状态文件与插件源码推断），不做任何写入。
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.QQ_AGENT_HOME || 'E:/QQ Agent/resources/app';
const UI_NEXT = path.join(APP, 'ui-next');
const UI_DIR = fs.existsSync(UI_NEXT) ? UI_NEXT : path.join(APP, 'ui');
const INDEX = path.join(UI_DIR, 'index.html');
const PLUGIN = path.join(APP, 'plugins', 'theme-mode', 'index.js');

console.log('伺服的 UI 目录：' + UI_DIR);
console.log('index.html   ：' + INDEX);

if (!fs.existsSync(INDEX)) { console.error('找不到 index.html'); process.exit(1); }
const html = fs.readFileSync(INDEX, 'utf8');

// 插件会注入哪些脚本（从插件源码里抓 SWITCHER_FILE 与各 theme 的 script 行）
const wanted = [];
if (fs.existsSync(PLUGIN)) {
  const src = fs.readFileSync(PLUGIN, 'utf8');
  for (const m of src.matchAll(/script:\s*'([^']*<script[^']*)'/g)) wanted.push(m[1].trim());
}
console.log('\n插件源码里声明的注入行：');
for (const w of wanted) console.log('  ' + w);

console.log('\n部署目录 index.html 里**当前存在**的插件注入：');
const present = [];
for (const w of wanted) {
  const m = w.match(/src="([^"]+)"/);
  if (!m) continue;
  const src = m[1];
  const ok = html.includes(src);
  present.push({ src, ok });
  console.log(`  ${ok ? '✔' : '✗'} ${src}`);
}

// 这些注入行对应的文件是否也在部署目录里
console.log('\n对应文件是否已部署：');
for (const p of present) {
  const f = path.join(UI_DIR, p.src.replace(/^\//, ''));
  console.log(`  ${fs.existsSync(f) ? '✔' : '✗'} ${p.src}`);
}

// 工作区 index.html 是否含这些注入（决定 apply-ui 会不会冲掉）
const WS = path.resolve('app/ui/index.html');
if (fs.existsSync(WS)) {
  const wsHtml = fs.readFileSync(WS, 'utf8');
  console.log('\n工作区 app/ui/index.html 是否含这些注入：');
  const wouldLose = [];
  for (const p of present) {
    const inWs = wsHtml.includes(p.src);
    if (p.ok && !inWs) wouldLose.push(p.src);
    console.log(`  ${inWs ? '含（部署后保留）' : '不含（部署后会被冲掉）'}  ${p.src}`);
  }
  console.log();
  if (wouldLose.length) {
    console.log('⚠️ 结论：`apply-ui --apply` 会移除以下注入 → 该功能在插件下次自检前不可用：');
    for (const s of wouldLose) console.log('     ' + s);
    console.log('\n   缓解：插件自检会重新注入。若自检周期很长，部署后请手工确认。');
  } else {
    console.log('结论：部署不会影响插件注入 ✔');
  }
}

// 插件状态文件
const ST = path.join(UI_DIR, 'theme-mode-status.json');
if (fs.existsSync(ST)) {
  console.log('\n插件状态文件：' + ST);
  try {
    const j = JSON.parse(fs.readFileSync(ST, 'utf8'));
    console.log('  ' + JSON.stringify(j).slice(0, 300));
    console.log('  mtime: ' + fs.statSync(ST).mtime.toLocaleString());
  } catch { console.log('  （解析失败）'); }
}
