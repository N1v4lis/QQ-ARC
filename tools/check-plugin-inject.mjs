// ═══════════════════════════════════════════════════════════════════════════
// check-plugin-inject.mjs — 守卫"宿主插件对部署界面的注入"
// ═══════════════════════════════════════════════════════════════════════════
// 为什么需要这一套（这是一个**真实的移交缺口**，差点让接手方掉坑）：
//
//   `plugins/theme-mode` 会往**当前被伺服**的 index.html 里注入
//     <script defer src="/theme-switcher.js"></script>
//   而 `tools/apply-ui.mjs --apply` 是**整目录用工作区镜像覆盖** ——
//   工作区的 index.html **不含**这一行（注入由插件自己拥有，源码里没有）。
//   于是：**每次部署都会把插件的注入冲掉**，主题切换入口暂时消失，
//   而接手方会以为是自己的改动弄坏的。
//
// 本套件把这个事实**变成可见的断言**。两条纪律：
//   ① QQ Agent / theme-mode 插件不在时**跳过**（打印说明），不判失败 ——
//      否则在没装插件的机器上回归会无意义地红。
//   ② 注入被冲掉时**判失败并给出补救命令** —— 因为"部署把别人注入的东西弄丢了"
//      这件事必须被看见，而不是让人对着缺失的按钮猜。
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.QQ_AGENT_HOME || 'E:/QQ Agent/resources/app';
const UI_NEXT = path.join(APP, 'ui-next');
const UI_DIR = fs.existsSync(UI_NEXT) ? UI_NEXT : path.join(APP, 'ui');
const INDEX = path.join(UI_DIR, 'index.html');
const PLUGIN_DIR = path.join(APP, 'plugins', 'theme-mode');
const WS_INDEX = 'app/ui/index.html';

let pass = 0; let fail = 0; let skipped = 0;
const ok = (n, c, e = '') => { if (c) { pass += 1; console.log(`✔ ${n}${e ? ' — ' + e : ''}`); } else { fail += 1; console.log(`✗ ${n}${e ? ' — ' + e : ''}`); } };
const skip = (n, why) => { skipped += 1; console.log(`· 跳过 ${n} —— ${why}`); };

/* ── 前置：环境是否具备 ─────────────────────────────────────────────────── */
if (!fs.existsSync(INDEX)) {
  skip('插件注入守卫', `找不到部署的 index.html（${INDEX}）`);
  console.log(`\n宿主插件注入：${pass} 通过 / ${fail} 失败 / ${skipped} 跳过。`);
  process.exit(0);
}
const pluginInstalled = fs.existsSync(PLUGIN_DIR);
const deployedHtml = fs.readFileSync(INDEX, 'utf8');

/* ── ① 部署界面的注入状态 ───────────────────────────────────────────────── */
const SWITCHER = '/theme-switcher.js';
const injected = deployedHtml.includes(SWITCHER);
console.log(`部署界面：${UI_DIR}`);
console.log(`theme-mode 插件：${pluginInstalled ? '已安装' : '未安装'}`);
console.log(`当前 index.html ${injected ? '含' : '不含'} ${SWITCHER} 注入`);

/* ── ② 工作区是否会冲掉注入（这是要交接的核心事实）────────────────────── */
if (fs.existsSync(WS_INDEX)) {
  const wsHtml = fs.readFileSync(WS_INDEX, 'utf8');
  const wsHas = wsHtml.includes(SWITCHER);
  ok('工作区 index.html **不含**插件注入（注入由插件自己拥有，不该抄进源码）',
    !wsHas, wsHas ? '竟然含 —— 那它不是插件注入，而是被手工抄进源码了' : '');
  if (pluginInstalled && !wsHas) {
    console.log('   ℹ️ 因此：`apply-ui --apply` 会移除该注入（这是预期行为，不是 bug）。');
    console.log('      插件下次自检会重新注入；部署后如发现入口消失，重跑插件自检即可。');
  }
} else {
  skip('工作区 index.html 检查', `找不到 ${WS_INDEX}`);
}

/* ── ③ 注入指向的文件必须真的在部署目录里（否则是 404 死链）───────────── */
if (injected) {
  const target = path.join(UI_DIR, SWITCHER.replace(/^\//, ''));
  ok('注入的脚本文件确实已部署（不是 404 死链）', fs.existsSync(target), target);
} else if (pluginInstalled) {
  ok('插件已安装时，部署界面应含注入（否则主题入口消失，需重跑插件自检）',
    false, `缺少 ${SWITCHER} —— 补救：让 theme-mode 插件重跑一次自检，或从 _backup 取回注入后的 index.html`);
} else {
  ok('未安装插件时不要求注入', true, '');
}

/* ── ④ 该注入在新 UI 里是**无操作**：说明清楚，避免误判为"功能坏了" ────── */
if (injected) {
  const switcher = path.join(UI_DIR, SWITCHER.replace(/^\//, ''));
  if (fs.existsSync(switcher)) {
    const src = fs.readFileSync(switcher, 'utf8');
    // 它只在技能弹窗（`.skill-modal` 且含 theme-mode 标识）里注入 UI
    const hostBound = /\.skill-modal/.test(src);
    ok('确认该注入的宿主是 `.skill-modal` —— 新 UI 没有该弹窗，故它是无操作而非可用功能',
      hostBound, hostBound ? '在新 UI 下不会有可见变化（预期）' : '宿主判断变了，需重新评估它是否已在新 UI 生效');
  }
}

/* ── ⑤ 状态文件存在性（插件自检的证据）────────────────────────────────── */
const ST = path.join(UI_DIR, 'theme-mode-status.json');
if (fs.existsSync(ST)) {
  try {
    const j = JSON.parse(fs.readFileSync(ST, 'utf8'));
    console.log(`   插件状态：mode=${j.mode} appliedTheme=${JSON.stringify(j.appliedTheme)} missing=${JSON.stringify(j.missing || [])}`);
    // ⚠️ 插件的 `missing` 检测**不认识 theme-switcher 的注入形式**（它按主题脚本名匹配），
    //    所以它可能报"未注入任何主题"而实际切换器已注入。这是插件侧的误报，不是本项目的缺陷。
    if (Array.isArray(j.missing) && j.missing.length && injected) {
      console.log('   ℹ️ 插件报 missing 但仍看到切换器注入：插件的检测只匹配主题脚本名，属插件侧误报。');
    }
  } catch { console.log('   （状态文件解析失败，忽略）'); }
} else {
  skip('插件状态文件', '不存在（插件可能从未跑过自检）');
}

console.log(`\n宿主插件注入：${pass} 通过 / ${fail} 失败 / ${skipped} 跳过。`);
process.exit(fail ? 2 : 0);
