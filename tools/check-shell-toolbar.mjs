// 外壳改版的验收：标题栏只留窗口按钮、功能控件在内容区工具栏里。
// 用法：node tools/check-shell-toolbar.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时
  //    （表现为"元素等不到 / 布局像坏了"，其实是没点到）。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await sleep(2800);

  const r = await page.eval(`(() => {
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const topbar = document.getElementById('topbar');
    // ⚠️ 2026-10-04「无痕」改版：工具栏移到了 .q-body 下、横跨整窗。
    //    选择器兼容两种位置，避免改版后工具静默量不到东西。
    const toolbar = document.querySelector('.q-body > .q-tb-status, .q-main > .q-tb-status');
    const main = document.getElementById('layout');
    const sidebar = document.querySelector('.q-sidebar');
    const winctl = document.getElementById('q-winctl');
    const body = document.querySelector('.q-body');
    // 标题栏里应当只剩这些子元素
    const topbarKids = topbar ? [...topbar.children].map((el) => String(el.className || el.id || el.tagName)) : [];
    // 功能控件的实际归属
    const CTL = ['onebot-dot', 'onebot-label', 'account-switch', 'model-label', 'usage-label',
      'search-count-label', 'readiness-dots', 'theme-btn', 'pause-btn'];
    const ctlInfo = CTL.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, found: false };
      const b = el.getBoundingClientRect();
      return {
        id, found: true,
        inToolbar: !!(toolbar && toolbar.contains(el)),
        inTopbar: !!(topbar && topbar.contains(el)),
        visible: b.width > 0 && b.height > 0,
        box: { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left) }
      };
    });
    // 工具栏与视图是否上下排开（不重叠）
    const view = document.querySelector('.view.active');
    // 「无痕」：横向接缝不能有可见的线或间隙
    const seam = (el) => {
      if (!el && el !== 0) return null;
      if (!el || typeof el.getBoundingClientRect !== 'function') return null;
      const cs = getComputedStyle(el);
      return { borderBottomWidth: cs.borderBottomWidth, borderBottomColor: cs.borderBottomColor, bg: cs.backgroundColor };
    };
    return {
      topbar: box(topbar), toolbar: box(toolbar), main: box(main), sidebar: box(sidebar), winctl: box(winctl), body: box(body),
      topbarKids, ctlInfo,
      viewBox: box(view),
      titlebarH: getComputedStyle(document.documentElement).getPropertyValue('--q-titlebar-h').trim(),
      toolbarH: getComputedStyle(document.documentElement).getPropertyValue('--q-toolbar-h').trim(),
      shell: document.documentElement.getAttribute('data-shell'),
      topbarSeam: seam(topbar), toolbarSeam: seam(toolbar),
      mainBg: getComputedStyle(main).backgroundColor
    };
  })()`);

  console.log(`外壳=${r.shell}  标题栏 ${r.topbar.w}x${r.topbar.h}  工具栏 ${r.toolbar.w}x${r.toolbar.h}  侧栏宽 ${r.sidebar.w}\n`);
  console.log('标题栏子元素：', r.topbarKids.join(' | '));
  console.log('\n功能控件归属：');
  for (const c of r.ctlInfo) {
    console.log(`  #${c.id.padEnd(20)} 工具栏内=${String(c.inToolbar).padEnd(5)} 标题栏内=${String(c.inTopbar).padEnd(5)} 可见=${String(c.visible).padEnd(5)} top=${c.box ? c.box.t : '-'}`);
  }

  // ⚠️ 环境差异：headless Edge 里 `data-shell=browser`，
  //    shell/99-shell-boot.js 会**按设计**摘掉 #q-winctl（浏览器里没有窗口可控制）。
  //    所以"标题栏子元素"数量和"窗口三键存在"这两条只在真实 Electron 里成立，
  //    在 browser 模式下要按 browser 的预期断言 —— 否则会误报失败。
  const isElectron = r.shell === 'electron';
  if (isElectron) {
    ok('标题栏里只剩 品牌区 / 占位 / 窗口按钮',
      r.topbarKids.length === 3 && r.topbarKids.includes('q-winctl'), r.topbarKids.join(' | '));
    ok('窗口三键仍在标题栏里且可见', !!r.winctl && r.winctl.h > 0,
      r.winctl ? `${r.winctl.w}x${r.winctl.h}` : '缺失');
  } else {
    ok('浏览器模式：标题栏只剩 品牌区 / 占位（窗口键按设计摘除）',
      r.topbarKids.length === 2 && !r.winctl, r.topbarKids.join(' | '));
    console.log('  （窗口三键需在真实 Electron 窗口里验证，见 tools/shot-window.mjs）');
  }
  // ⚠️ 2026-10-04「无痕」：工具栏横跨**整窗**（含侧栏上方）。
  //    放在 .q-main 里时它从侧栏右界开始，右侧对得上但左侧会"断"出凹口。
  ok('工具栏横跨整个窗口宽度（含侧栏上方）',
    !!r.toolbar && r.toolbar.l <= r.topbar.l + 1 && r.toolbar.r >= r.topbar.r - 1,
    `工具栏 ${r.toolbar.l}~${r.toolbar.r} / 标题栏 ${r.topbar.l}~${r.topbar.r}`);
  ok('工具栏紧贴标题栏下方', Math.abs(r.toolbar.t - r.topbar.b) <= 1, `标题栏底=${r.topbar.b} 工具栏顶=${r.toolbar.t}`);
  ok('工具栏高度符合 --q-toolbar-h', Math.abs(r.toolbar.h - parseFloat(r.toolbarH)) <= 1, `${r.toolbar.h}px / 变量 ${r.toolbarH}`);
  ok('全部功能控件都在工具栏里（不在标题栏）',
    r.ctlInfo.every((c) => c.found && c.inToolbar && !c.inTopbar),
    r.ctlInfo.filter((c) => !c.inToolbar).map((c) => c.id).join(', ') || '全部就位');
  ok('全部功能控件都可见', r.ctlInfo.every((c) => c.visible),
    r.ctlInfo.filter((c) => !c.visible).map((c) => c.id).join(', ') || '全部可见');
  ok('视图被工具栏向下推移（不与工具栏重叠）',
    r.viewBox && r.viewBox.t >= r.toolbar.b - 1,
    `工具栏底=${r.toolbar.b} 视图顶=${r.viewBox ? r.viewBox.t : '-'}`);
  ok('侧栏也从工具栏下方开始（工具栏占满第一行）',
    r.sidebar.t >= r.toolbar.b - 1, `工具栏底=${r.toolbar.b} 侧栏顶=${r.sidebar.t}`);

  // ── 无痕：横向接缝既无线也无间隙 ──────────────────────────────────────
  ok('标题栏底边没有边框线',
    r.topbarSeam && parseFloat(r.topbarSeam.borderBottomWidth) === 0,
    `border-bottom=${r.topbarSeam ? r.topbarSeam.borderBottomWidth : '?'}`);
  ok('功能条底边没有边框线',
    r.toolbarSeam && parseFloat(r.toolbarSeam.borderBottomWidth) === 0,
    `border-bottom=${r.toolbarSeam ? r.toolbarSeam.borderBottomWidth : '?'}`);
  ok('标题栏与功能条同底色（连成一条顶栏）',
    r.topbarSeam && r.toolbarSeam && r.topbarSeam.bg === r.toolbarSeam.bg,
    `${r.topbarSeam ? r.topbarSeam.bg : '?'} vs ${r.toolbarSeam ? r.toolbarSeam.bg : '?'}`);
  ok('功能条与内容区同底色（无可见分界）',
    r.toolbarSeam && r.toolbarSeam.bg === r.mainBg,
    `${r.toolbarSeam ? r.toolbarSeam.bg : '?'} vs ${r.mainBg}`);
  // ⚠️ 这条是"无痕"的关键：顶栏必须用**内容区**的底色令牌（--q-bg-base），
  //    不能用 --q-bg-sidebar —— 两者浅色下同值、**暗色下差 6 级明度**，
  //    会在 y=92 处露出一条横贯整窗的色差线（计算样式里 border 全是 0px，
  //    所以只有像素采样才能抓到，见 tools/check-seamless-pixels.mjs）。
  ok('标题栏与内容区也同底色（暗色下最容易露馅的一处）',
    r.topbarSeam && r.topbarSeam.bg === r.mainBg,
    `${r.topbarSeam ? r.topbarSeam.bg : '?'} vs ${r.mainBg}`);
  ok('标题栏与功能条之间没有间隙', Math.abs(r.toolbar.t - r.topbar.b) <= 1,
    `间隙 ${r.toolbar.t - r.topbar.b}px`);
  ok('功能条与内容区之间没有间隙（侧栏/视图紧接其后）',
    Math.abs(r.sidebar.t - r.toolbar.b) <= 1 && Math.abs(r.viewBox.t - r.toolbar.b) <= 1,
    `侧栏间隙 ${r.sidebar.t - r.toolbar.b}px / 视图间隙 ${r.viewBox.t - r.toolbar.b}px`);

  await page.screenshot('shots/final/shell-toolbar.png');
  console.log('\n截图：shots/final/shell-toolbar.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n外壳工具栏改版验收通过。');
process.exit(failed ? 2 : 0);
