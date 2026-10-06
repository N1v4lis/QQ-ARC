// Beta 提示条验收：文案逐字一致、位置在仪表盘顶端、两套主题下对比度足够、
// 骨架态与正式态都在（数据回来后不会"突然长出来"把内容顶下去）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

// 用户给定的原文（逐字），用来断言"没有被顺手润色"
const LINE1 = '注意！这是“QQ Agent 还没想好叫什么版”的Beta测试版本。';
// ⚠️ 第二行里 "Beta" 与 "测试版本" 之间**有一个空格**（用户明确要求）。
//    用 \u0020 写出来，避免被编辑器/格式化工具悄悄删掉。
const LINE2 = 'Beta\u0020测试版本不代表本产品的最终质量。感谢您的理解和支持，祝你好运！';

const lum = (r, g, b) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const parse = (s) => {
  const str = String(s);
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(str);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  // ⚠️ `color-mix()` 算出来的颜色，computedStyle 会回成 **color(srgb r g b)** 或
  //    color(srgb r g b / a)，分量是 0~1 的浮点。第一版只认 rgb()，于是对比度算不出来
  //    （报 "?"），被当失败 —— 这是量测口径的问题，不是颜色不行。
  const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/.exec(str);
  if (c) return [Number(c[1]) * 255, Number(c[2]) * 255, Number(c[3]) * 255, c[4] === undefined ? 1 : Number(c[4])];
  return null;
};
/** 把半透明前景合成到背景上，再算对比度（和 check-tier-buttons-theme 同一套口径） */
const contrast = (fg, bg) => {
  const f = parse(fg), b = parse(bg);
  if (!f || !b) return null;
  const a = f[3];
  const mix = [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a)];
  const L1 = lum(mix[0], mix[1], mix[2]), L2 = lum(b[0], b[1], b[2]);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  // ⚠️ 必须等启动遮罩摘除再点页签：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时。
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="dashboard"]')`, { timeout: 20000, label: '导航' });
  await page.click('#tabs .tab[data-tab="dashboard"]');
  await page.waitFor(`document.querySelector('#dashboard-page .dash-beta')`, { timeout: 15000, label: 'Beta 提示条（骨架态就该有）' });

  // ── 骨架态：提示条必须已经在（否则数据回来时会"长出来"把内容顶下去）
  ok('骨架态就有 Beta 提示条（不会加载完才冒出来）',
    await page.eval(`!!document.querySelector('#dashboard-page .dash-beta')`), '');

  // 等数据回来（stats 冷启动约 5 秒）
  await page.waitFor(`document.querySelector('#dashboard-page .dc-dot')`, { timeout: 40000, label: '数据渲染' });
  await sleep(600);

  for (const theme of ['light', 'dark']) {
    await page.eval(`(() => { window.applyTheme(${JSON.stringify(theme)}); return 1; })()`);
    await sleep(500);
    const r = await page.eval(`(() => {
      const beta = document.querySelector('#dashboard-page .dash-beta');
      if (!beta) return { missing: true };
      const lines = [...beta.querySelectorAll('.dash-beta-line')];
      const badge = beta.querySelector('.dash-beta-badge');
      const badgeSvg = badge ? badge.querySelector('svg') : null;
      const textBox = beta.querySelector('.dash-beta-text');
      const inner = beta.querySelector('.dash-beta-inner');
      const wrap = document.querySelector('#dashboard-page .dash-wrap');
      const head = document.querySelector('#dashboard-page .dash-head');
      const boxes = document.querySelector('#dashboard-page .dash-boxes');
      const B = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width), l: Math.round(b.left), r: Math.round(b.right) }; };
      const cs = getComputedStyle(beta);
      const l0 = lines[0] ? getComputedStyle(lines[0]) : null;
      const l1 = lines[1] ? getComputedStyle(lines[1]) : null;
      const bs = badge ? getComputedStyle(badge) : null;
      return {
        texts: lines.map((el) => el.textContent.trim()),
        count: lines.length,
        betaBox: B(beta), headBox: B(head), boxesBox: B(boxes), wrapBox: B(wrap),
        badgeBox: B(badge), textBox: B(textBox), innerBox: B(inner),
        badgeColor: bs ? bs.color : null,
        // 徽章里应当是"六边形 + 感叹号"：1 个 path + 1 个 rect + 1 个 circle
        badgeShaper: badgeSvg ? {
          path: badgeSvg.querySelectorAll('path').length,
          rect: badgeSvg.querySelectorAll('rect').length,
          circle: badgeSvg.querySelectorAll('circle').length
        } : null,
        bg: cs.backgroundColor, textAlign: cs.textAlign,
        display: cs.display, alignItems: cs.alignItems,
        innerAlignItems: inner ? getComputedStyle(inner).alignItems : null,
        line1Align: l0 ? l0.textAlign : null,
        line2Align: l1 ? l1.textAlign : null,
        borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle,
        line1Color: l0 ? l0.color : null,
        line1Weight: l0 ? l0.fontWeight : null,
        line1Size: l0 ? l0.fontSize : null,
        line1Line: l0 ? l0.lineHeight : null,
        line1Font: l0 ? l0.fontFamily : null,
        line2Weight: l1 ? l1.fontWeight : null,
        line2Size: l1 ? l1.fontSize : null,
        line2Line: l1 ? l1.lineHeight : null,
        radius: cs.borderRadius
      };
    })()`);
    if (r.missing) { ok(`[${theme}] Beta 提示条存在`, false); continue; }
    ok(`[${theme}] 文案与给定原文逐字一致`, r.texts[0] === LINE1 && r.texts[1] === LINE2,
      r.texts[0] === LINE1 && r.texts[1] === LINE2 ? '两行都对' : JSON.stringify(r.texts));
    ok(`[${theme}] 提示条在仪表盘最顶端（在标题与信息卡之前）`,
      r.betaBox.t < r.headBox.t && r.betaBox.b <= r.headBox.t + 2,
      `提示条 ${r.betaBox.t}~${r.betaBox.b} / 标题顶 ${r.headBox.t}`);
    // 用户要求"整体文字和符号都居中显示"：徽章 + 两行文字作为一个整体居中，
    // 且两行文字自身也居中。
    // ⚠️ 布局属性要读 .dash-beta-inner（真正管内部排布的那层），不是 .dash-beta：
    //    外层只负责黄底与"内容整体居中"，它的 text-align/align-items 都是初始值。
    //    我第一版读错层，得到的 text-align=start / align-items=normal 全是**默认值**，
    //    于是一条正确的实现被判成失败 —— 断言取错元素比实现对更常见。
    const barBox = r.betaBox;
    ok(`[${theme}] 内容整体居中（徽章+文字的组合在中线附近）`,
      r.innerBox && Math.abs((r.innerBox.l + r.innerBox.r) / 2 - (barBox.l + barBox.r) / 2) <= 6,
      `组合中点 ${r.innerBox ? Math.round((r.innerBox.l + r.innerBox.r) / 2) : '-'} / 横幅中点 ${Math.round((barBox.l + barBox.r) / 2)}`);
    ok(`[${theme}] 两行文字自身居中`, r.line1Align === 'center' && r.line2Align === 'center',
      `text-align=${r.line1Align}/${r.line2Align}`);
    // 第二行 "Beta" 与 "测试版本" 之间要有空格（用户明确要求）
    ok(`[${theme}] 第二行 Beta 与 测试版本 之间有空格`,
      /Beta\s测试版本/.test(String(r.texts[1] || '')), `实际=「${String(r.texts[1]).slice(0, 22)}…」`);
    ok(`[${theme}] 左侧还原了感叹号徽章`, !!r.badgeBox && !!r.textBox && r.badgeBox.l < r.textBox.l,
      `徽章 x ${r.badgeBox ? r.badgeBox.l : '-'} < 文字 x ${r.textBox ? r.textBox.l : '-'}`);
    ok(`[${theme}] 徽章是"六边形 + 感叹号"（path + rect + circle）`,
      r.badgeShaper && r.badgeShaper.path === 1 && r.badgeShaper.rect === 1 && r.badgeShaper.circle === 1,
      JSON.stringify(r.badgeShaper));
    ok(`[${theme}] 徽章底色是黑的（原图那颗是黑六边形）`,
      String(r.badgeColor).replace(/\s/g, '') === 'rgb(15,15,16)', `徽章 color=${r.badgeColor}`);
    ok(`[${theme}] 徽章与文字左右排布且垂直居中`,
      r.display === 'flex' && r.innerAlignItems === 'center',
      `外层 display=${r.display}，内层 align-items=${r.innerAlignItems}`);
    ok(`[${theme}] 上下有描边（塔科夫那条的形态特征）`,
      parseFloat(r.borderTop) >= 1 && parseFloat(r.borderBottom) >= 1,
      `top=${r.borderTop} bottom=${r.borderBottom}`);
    ok(`[${theme}] 第一行加粗且比第二行大（层级分明）`,
      Number(r.line1Weight) >= 700 && parseFloat(r.line1Size) > parseFloat(r.line2Size),
      `首行 ${r.line1Weight}/${r.line1Size} vs 次行 ${r.line2Weight}/${r.line2Size}`);
    // 字体：中文命中宋体、英文命中 Bender（按用户确认的塔科夫实际用字）。
    // 注意 computedStyle 只能读到**字体栈声明**，读不到"某个字实际用了哪个字体"，
    // 所以这里断言栈的顺序与内容；"是否真的命中"由 tools/probe-fonts.mjs 用
    // Canvas 量宽度来验证。
    ok(`[${theme}] 字体栈含 Bender（英文，塔科夫实际用字）`,
      /Bender/i.test(String(r.line1Font)), String(r.line1Font).slice(0, 96));
    ok(`[${theme}] 字体栈含宋体（中文，塔科夫实际用字）+ 非衬线兜底`,
      /宋体|SimSun/i.test(String(r.line1Font)) && /serif/i.test(String(r.line1Font)),
      String(r.line1Font).slice(0, 96));
    // 徽章要比文字明显大：用户两次要求"再大一点"，现在 58px
    ok(`[${theme}] 徽章够大（≥54px，与两行文字总高相当）`,
      r.badgeBox && r.badgeBox.w >= 54 && r.badgeBox.h >= 54,
      `徽章 ${r.badgeBox ? r.badgeBox.w + 'x' + r.badgeBox.h : '-'}px / 首行 ${r.line1Size}`);
    // 宋体清晰度的关键：字号与行高必须是**整数 px**（宋体是点阵字体，
    // 非整数缩放会触发反锯齿、整条字发虚）。见 21-dashboard.css 的说明。
    const isIntPx = (v) => /^\d+px$/.test(String(v));
    ok(`[${theme}] 字号与行高都是整数 px（宋体点阵字体不糊的前提）`,
      isIntPx(r.line1Size) && isIntPx(r.line1Line) && isIntPx(r.line2Size) && isIntPx(r.line2Line) && isIntPx(r.badgeBox.w + 'px'),
      `首行 ${r.line1Size}/${r.line1Line}、次行 ${r.line2Size}/${r.line2Line}、徽章 ${r.badgeBox.w}px`);
    const ratio = contrast(r.line1Color, r.bg);
    ok(`[${theme}] 文字与黄底对比度 ≥ 4.5`, ratio !== null && ratio >= 4.5,
      `对比度 ${ratio === null ? '?' : ratio.toFixed(2)}（${r.line1Color} on ${r.bg}）`);
  }

  await page.eval(`(() => { window.applyTheme('light'); return 1; })()`);
  await page.screenshot('shots/final/dashboard-beta.png');
  console.log('\n截图：shots/final/dashboard-beta.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\nBeta 提示条验收通过。');
process.exit(failed ? 2 : 0);
