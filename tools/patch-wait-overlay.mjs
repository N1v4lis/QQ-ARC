// 给一批测试工具补上"等启动遮罩摘除"的等待。
//
// 为什么需要（2026-10-04 实测）：应用刚启动时有一个 z-index:999 的 loading-overlay
// 盖住整窗。CDP 的 page.click 是**按坐标派发**真实鼠标事件，
// 所以点击会落在遮罩上、页签根本没被点到 ——
// 表现为后面所有 waitFor 超时（"设置菜单/峰谷滑条 等不到"），
// 看起来像功能坏了。等遮罩摘掉即可，不需要加长超时。
//
// 这个脚本把统一的等待片段插到"页面已就绪、准备点页签"的位置。
import fs from 'node:fs';

const WAIT = `  // ⚠️ 必须等启动遮罩摘除再点页签：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时。
  await page.waitFor(\`!document.getElementById('loading-overlay')\`, { timeout: 30000, label: '启动遮罩摘除' });
`;

// 这些工具都是"打开页面 → 点设置页签"的模式，都需要这段等待。
const TARGETS = [
  'tools/check-readout-layout.mjs',
  'tools/check-tier-buttons-theme.mjs',
  'tools/check-personalize.mjs',
  'tools/check-slider-switch.mjs',
  'tools/check-dashboard.mjs',
  'tools/check-dashboard-beta.mjs',
  'tools/check-nav-consistency.mjs',
  'tools/check-nav-color-continuity.mjs',
  'tools/check-nav-rail.mjs',
  'tools/check-shell-toolbar.mjs',
  'tools/check-seamless-pixels.mjs'
];

let changed = 0;
for (const f of TARGETS) {
  if (!fs.existsSync(f)) { console.log(`跳过（不存在）：${f}`); continue; }
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes("label: '启动遮罩摘除'")) { console.log(`已具备：${f}`); continue; }
  // 插在第一次出现的 waitFor 之前（这些工具都以一次 waitFor 开场）
  const m = /(\n[ \t]*await page\.waitFor\(`)/.exec(s);
  if (!m) { console.log(`⚠️ 找不到插入点：${f}`); continue; }
  const at = m.index + 1;   // 落在行首
  s = s.slice(0, at) + WAIT + s.slice(at);
  fs.writeFileSync(f, s);
  changed += 1;
  console.log(`✔ 已插入：${f}`);
}
console.log(`\n共修改 ${changed} 个文件。`);
