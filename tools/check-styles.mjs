// 元素样式断言：把"这个元素应该长成什么样"写成可执行的期望值。
// 为什么需要它：截图只能靠肉眼，而"旧皮肤在背后把我覆盖了"这类问题
// （无边框 → 加上胶囊边框、grid → 变成单行居中）肉眼很难逐条发现，
// 但用计算样式一比就立刻现形。全部用**计算值**比较，不看源码里写了什么。
//
// 用法：node tools/check-styles.mjs [url]
// 退出码：0 全通过；2 有失败
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;

// ⚠️ 视口宽度必须 > 880px（窄窗口媒体查询会把侧栏切成 rail 形态，
//    justify-content 会变成 center、高度也会变 —— 实测在 1200px 下就踩到了，
//    三条断言"失败"其实是被 880px 那条媒体查询接管，白白排查了半天）。
//    这里固定用 1600×900，保证测的是"正常桌面窗口"下的形态。
const VIEWPORT = { width: 1600, height: 900 };

// [页签, 选择器, 属性, 期望值（字符串或正则）, 说明]
const CASES_BASE = [
  // —— 侧栏：必须是"无边框的列表行"，不是胶囊按钮 ——
  // 注意这里查的是 borderColor 而不是 borderWidth：
  // 新版写的是 `border: 1px solid transparent`（保留 1px 占位，避免悬停/激活时
  // 因为边框出现而抖动），所以宽度仍是 1px，**透明**才是"看起来没有边框"的关键。
  ['sessions', '.q-side-foot .nav-btn#quote-btn', 'borderTopColor', /rgba\(0, 0, 0, 0\)|transparent/, '侧栏入口边框透明（旧皮肤是描边胶囊）'],
  ['sessions', '.q-side-foot .nav-btn#quote-btn', 'borderRadius', '8px', '侧栏入口应是圆角矩形'],
  ['sessions', '.q-side-foot .nav-btn#quote-btn', 'justifyContent', 'flex-start', '侧栏入口左对齐'],
  ['sessions', '.q-side-foot .nav-btn#quote-btn', 'textAlign', 'left', '侧栏入口文字左对齐'],
  ['sessions', '.q-side-foot .nav-btn#open-site-btn', 'backgroundColor', /rgba\(0, 0, 0, 0\)|transparent/, '侧栏入口底色透明（不是实心蓝按钮）'],
  // 查 clientHeight 而不是计算样式的 height：flex 子项的 height:auto 是设计如此，
  // 真实行高要看渲染结果（~36px）。这里用 __clientHeight 这个自定义键取。
  // ⚠️ 选择器必须带 id：`.q-side-foot .nav-btn` 命中的第一个是 #quote-confirm-btn，
  //    它默认带 .hidden（勾选金句模式才出现），clientHeight 恒为 0 —— 又是一次
  //    "断言失败但代码没问题"。凡是测尺寸都要挑一个确定可见的元素。
  ['sessions', '.q-side-foot .nav-btn#quote-btn', '__clientHeight', /^3[0-9]$/, '侧栏入口渲染行高 30-39px'],
  // ⚠️ 2026-10-04「颜色连续」改版：激活页签不再填充底色，改用**主色文字 + 左侧强调条**
  //    表达状态（原来 hover/active 都是不透明填充，在整片同色的导航里就是两块异色方块）。
  //    因为去掉了底色对比，字重从 600 提到 650、并把图标也提为主色，保证仍然一眼可辨。
  ['sessions', '#tabs.q-side .tab.active', 'fontWeight', '650', '激活页签加粗（替代底色对比）'],
  ['sessions', '#tabs.q-side .tab.active', 'backgroundColor', 'rgba(0, 0, 0, 0)', '激活页签不填充底色（保持导航同色）'],
  // 激活图标 = 主色（浅色主题下 --q-accent = #4176e6 → rgb(65, 118, 230)）
  ['sessions', '#tabs.q-side .tab.active .tab-ico', 'color', 'rgb(65, 118, 230)', '激活页签图标用主色'],
  ['sessions', '#tabs.q-side .tab.active', 'boxShadow', 'none', '激活页签不该有旧皮肤的下划线投影'],
  // —— 模块卡（插件/技能）：必须是两列网格、标题左对齐 ——
  ['plugins', '.mcard', 'display', 'grid', '模块卡是网格布局'],
  ['plugins', '.mcard', 'gridTemplateAreas', /name.*acts/, '模块卡第一行是"标题 + 操作"'],
  ['plugins', '.mcard-name', 'textAlign', 'start', '模块标题左对齐'],
  ['plugins', '.mcard-main', 'display', 'contents', '.mcard-main 作为分组壳不参与布局'],
  ['plugins', '.mcard-acts', 'gridArea', 'acts', '操作按钮落在 acts 区'],

  // —— 设置页折叠卡 ——
  ['settings', '.setcard', 'borderRadius', '12px', '设置卡圆角跟随新令牌'],
  ['settings', '.setcard-head', 'display', 'flex', '卡头是 flex'],
  ['settings', '.settings-menu-item.active', 'fontWeight', '600', '激活的二级菜单加粗'],

  // —— 标题栏：按运行环境在下面追加（浏览器 48px / Electron 40px + 窗口按钮）——

  // —— 列表 ——
  ['sessions', '.session-item', 'cursor', 'pointer', '会话项可点'],
  ['sessions', '.session-item .status-badge', 'height', '18px', '状态徽标高度'],
  ['sessions', '#session-list', 'borderRightWidth', '1px', '列表与详情之间有分隔线']
];

const TITLEBAR_CASES = [
  // 浏览器里标题栏 48px（--q-titlebar-h 被 html[data-shell=browser] 抬高了）
  ['sessions', '#topbar.q-titlebar', 'height', '48px', '浏览器里标题栏 48px'],
  // ⚠️ 2026-10-04：功能工具栏现在在 `.q-body` 下、横跨整窗（含侧栏上方），
  //    与标题栏连成一条连续顶栏。放 .q-main 里会在侧栏右界处断掉、看着有凹口。
  ['sessions', '.q-body > .q-tb-status', 'alignItems', 'center', '功能工具栏垂直居中'],
  ['sessions', '.q-body > .q-tb-status', 'height', '44px', '功能工具栏 44px'],
  // 「无痕」要求：横向接缝全部不画线
  ['sessions', '#topbar.q-titlebar', 'borderBottomWidth', '0px', '标题栏与功能条之间无线'],
  ['sessions', '.q-body > .q-tb-status', 'borderBottomWidth', '0px', '功能条与内容区之间无线'],
  ['sessions', '#onebot-dot', 'width', '7px', '连接状态点 7px']
];
// Electron 里是 40px（自绘标题栏比浏览器那条品牌栏更紧凑），上面这条要换掉。
// 靠 <html data-shell> 自适应，避免"换个运行环境就有断言失败"的假告警。
const TITLEBAR_CASES_ELECTRON = [
  ['sessions', '#topbar.q-titlebar', 'height', '40px', 'Electron 里标题栏 40px'],
  ['sessions', '#q-winctl', 'display', 'flex', '自绘窗口按钮容器可见'],
  ['sessions', '#q-winctl .q-wclose', '__clientWidth', /^4[0-9]$/, '关闭按钮可点面积 ≥40px']
];

let pass = 0;
let total = 0;
const fails = [];

await withPage({ url: URL_, width: VIEWPORT.width, height: VIEWPORT.height }, async (page) => {
  // ⚠️ 用 waitFor 而不是固定 sleep（2026-10-04 修）：
  //    启动默认落在「仪表盘」，loadSettings() 要拉 config + skills，
  //    实测 2 秒以上才把二级菜单渲染出来；固定 sleep(2400) 之后
  //    切到 settings 页签时菜单可能还没出来，`.setcard` / `.settings-menu-item`
  //    全部报"不存在" —— 那是等待时机问题，不是样式坏了。
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '导航' });
  const env = await page.eval('document.documentElement.getAttribute("data-shell")');
  const CASES = env === 'electron' ? [...CASES_BASE, ...TITLEBAR_CASES_ELECTRON] : [...CASES_BASE, ...TITLEBAR_CASES];
  total = CASES.length;
  console.log(`运行环境：${env || '(未知)'} → 检查 ${CASES.length} 条\n`);
  let currentTab = null;
  for (const [tab, sel, prop, want, why] of CASES) {
    if (tab !== currentTab) {
      const c = await page.click(`#tabs .tab[data-tab="${tab}"]`);
      if (!c || !c.ok) { fails.push(`[${tab}] 页签点不开`); continue; }
      // 切到设置页要等二级菜单真的渲染出来（其余页签只需等视图切换）
      if (tab === 'settings') {
        await page.waitFor(`document.querySelector('.settings-menu-item')`, { timeout: 25000, label: '设置菜单' });
      } else if (tab === 'plugins' || tab === 'skills') {
        // 模块页（插件/技能）内容是异步拉接口后渲染的，也要等 ——
        // 固定 sleep 之后 `.mcard` 还没出现，会被报成"样式失效"（实测）。
        await page.waitFor(`document.querySelector('.mcard')`, { timeout: 25000, label: tab + ' 模块卡' });
      } else {
        await sleep(1400);
      }
      currentTab = tab;
    }
    const got = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return '__NOT_FOUND__';
      const prop = ${JSON.stringify(prop)};
      // 允许几个自定义键：计算样式拿不到"渲染后的真实尺寸"，
      // 而 flex 子项的 height:auto 恰恰只能这么测。
      if (prop === '__clientHeight') return String(el.clientHeight);
      if (prop === '__clientWidth') return String(el.clientWidth);
      return getComputedStyle(el)[prop];
    })()`);
    const ok = typeof want === 'string' ? got === want : want.test(String(got));
    if (got === '__NOT_FOUND__') { fails.push(`[${tab}] ${sel} 不存在`); continue; }
    if (ok) { pass += 1; }
    else fails.push(`[${tab}] ${sel} 的 ${prop} = ${JSON.stringify(got)}，期望 ${want}　← ${why}`);
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

for (const f of fails) console.log('✗ ' + f);
console.log(`\n样式断言：${pass}/${total} 通过`);
if (fails.length) { console.log(`\n${fails.length} 条不符合预期（多半是被旧皮肤盖住了）。`); process.exit(2); }
console.log('全部符合新样式预期。');
