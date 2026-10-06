// ═══════════════════════════════════════════════════════════════════════════
// restore-plugin-inject.mjs — 把托管插件的注入**补回部署界面**
// ═══════════════════════════════════════════════════════════════════════════
// 为什么需要它：`apply-ui.mjs --apply` 是**整目录用工作区镜像覆盖**，
// 而工作区的 index.html **不含**插件注入的行、也没有插件拷进来的前端文件
// （注入与那些文件都由插件自己拥有）—— 所以每次部署都会冲掉两样东西：
//   ① 部署 index.html 里的 `<script defer src="/theme-switcher.js"></script>`
//   ② 部署目录里的 `theme-switcher.js`（插件从自己的 ui/ 拷过去的）
// 插件下次自检会重新做这两件事，但**时机不可控**（可能几十分钟才轮到一次），
// 于是部署后到那时之间，部署界面处于"半坏"状态：注入行在、文件 404。
//
// 这个脚本按插件**自己声明的注入行**（从 plugins/theme-mode/index.js 里读，不硬编码）
// 把这两样都补回去，保证"部署前后部署界面一致"。
//
//   node tools/restore-plugin-inject.mjs            # 检查并补回
//   node tools/restore-plugin-inject.mjs --dry-run  # 只看会做什么
//
// ⚠️ 它只写**部署目录**，绝不碰工作区（工作区不该有这些 —— 那是插件的职责）。
// ⚠️ 幂等：已有的不会重复添加。
import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const APP = process.env.QQ_AGENT_HOME || 'E:/QQ Agent/resources/app';
const UI_NEXT = path.join(APP, 'ui-next');
const UI_DIR = fs.existsSync(UI_NEXT) ? UI_NEXT : path.join(APP, 'ui');
const INDEX = path.join(UI_DIR, 'index.html');
const PLUGIN = path.join(APP, 'plugins', 'theme-mode', 'index.js');
const PLUGIN_UI = path.join(APP, 'plugins', 'theme-mode', 'ui');
const SWITCHER_FILE = 'theme-switcher.js';
const ANCHOR = '</body>';

if (!fs.existsSync(INDEX)) {
  console.error(`✗ 找不到部署的 index.html：${INDEX}`);
  process.exit(1);
}

// 插件源码里是否声明了这个注入（不硬编码注入行，跟着插件走）
let declared = false;
if (fs.existsSync(PLUGIN)) {
  declared = fs.readFileSync(PLUGIN, 'utf8').includes(SWITCHER_FILE);
}
if (!declared) {
  console.log('· theme-mode 插件未安装或未声明该注入，无需处理。');
  process.exit(0);
}

let changed = 0;

/* ── ① 前端文件：插件 ui/ → 部署目录 ───────────────────────────────────── */
// ⚠️ 不写死单个文件名，而是**把插件 ui/ 目录里的前端产物都补一遍**
//    （js/css/json）。理由：插件目录里有 theme-switcher.js 与若干主题包
//    （theme-elysia.js/css、theme-maid-atelier.js/css），插件是**按需**把
//    它们拷进部署目录的；写死一个就会漏掉其余的。
//    另外 `theme-mode-status.json` 是插件的运行时状态文件（自检时写），
//    它被镜像删掉会让页面 fetch 到 404 并在控制台留一条 error ——
//    虽然不影响功能，但会污染"控制台干净"这条验收，所以也从最近一次备份里补回。
const EXT_OK = /\.(js|css|json)$/i;
let filesCopied = 0;
const copiedNames = [];
if (fs.existsSync(PLUGIN_UI)) {
  const entries = fs.readdirSync(PLUGIN_UI, { withFileTypes: true }).filter((d) => d.isFile() && EXT_OK.test(d.name));
  for (const e of entries) {
    const src = path.join(PLUGIN_UI, e.name);
    const dst = path.join(UI_DIR, e.name);
    if (fs.existsSync(dst)) continue;
    if (DRY) {
      console.log(`[dry-run] 会拷贝 ${e.name} → 部署目录`);
      copiedNames.push(e.name);
      changed += 1;
      continue;
    }
    fs.copyFileSync(src, dst);
    copiedNames.push(e.name);
    filesCopied += 1;
    changed += 1;
  }
  if (copiedNames.length) console.log(`✔ 已补回插件前端文件 ${copiedNames.length} 个：${copiedNames.join(', ')}`);
  else console.log(`✔ 插件前端文件齐备（检查了 ${entries.length} 个）`);
} else {
  console.log('· 插件目录里没有 ui/，跳过文件恢复。');
}

/**
 * 状态文件单独处理：它不在插件的 ui/ 里，而是插件**自检时写进部署目录**的运行时产物。
 * 被镜像删掉后页面会 fetch 到 404（控制台一条 error），所以从最近一次部署备份里补回。
 * 找不到备份就跳过 —— 插件下次自检会重建，不是致命问题。
 */
const STATUS = 'theme-mode-status.json';
if (!fs.existsSync(path.join(UI_DIR, STATUS))) {
  const bakRoot = path.resolve('_backup');
  let restored = false;
  if (fs.existsSync(bakRoot)) {
    const cands = fs.readdirSync(bakRoot)
      .filter((d) => d.startsWith('ui-next-'))
      .sort()
      .reverse();
    for (const d of cands) {
      const p = path.join(bakRoot, d, STATUS);
      if (fs.existsSync(p)) {
        if (DRY) { console.log(`[dry-run] 会从备份 ${d} 补回 ${STATUS}`); }
        else { fs.copyFileSync(p, path.join(UI_DIR, STATUS)); console.log(`✔ 已从备份 ${d} 补回 ${STATUS}`); }
        changed += 1;
        restored = true;
        break;
      }
    }
  }
  if (!restored) console.log(`· ${STATUS} 缺失且备份里没有 —— 插件下次自检会重建（非致命）。`);
}

/* ── ② index.html 里的注入行 ──────────────────────────────────────────── */
const injection = `  <script defer src="/${SWITCHER_FILE}"></script>`;
let html = fs.readFileSync(INDEX, 'utf8');
if (html.includes(`/${SWITCHER_FILE}`)) {
  console.log(`✔ 注入已存在：${SWITCHER_FILE}`);
} else if (!html.includes(ANCHOR)) {
  console.error(`✗ index.html 里找不到锚点 ${ANCHOR}，拒绝改动。`);
  process.exit(1);
} else if (DRY) {
  console.log(`[dry-run] 会在 ${ANCHOR} 前插入：${injection.trim()}`);
  changed += 1;
} else {
  html = html.replace(ANCHOR, `${injection}\n${ANCHOR}`);
  fs.writeFileSync(INDEX, html, 'utf8');
  console.log(`✔ 已补回注入：${injection.trim()}`);
  changed += 1;
}

console.log();
if (DRY) {
  console.log(`[dry-run] 共需 ${changed} 处改动。`);
} else if (changed) {
  console.log(`共补回 ${changed} 处。写入：${UI_DIR}`);
  console.log('提示：这些属于**部署界面**，工作区源码保持不变（注入由插件拥有）。');
} else {
  console.log('无需改动 ✔');
}

