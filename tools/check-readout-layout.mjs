// 读数行布局：**两种模式都要测**
//   · 单档模式：说明一行
//   · 峰谷双点模式：说明两行（高峰 / 低谷），这正是上一版负边距算错、看着"糊住"的场景
// 断言：三个部分不重叠、按左中右排布、且滑条没有被任何东西压住。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

/** 在页面里量一次读数行；返回三部分的矩形与相交情况。 */
const MEASURE = `(() => {
  const big = document.querySelector('.tier-read .tr-big');
  const txt = document.querySelector('.tier-read .tr-txt');
  const tgt = document.querySelector('.tier-read .hint.ac-target');
  const B = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  if (!big || !txt) return { missing: true, big: !!big, txt: !!txt, tgt: !!tgt };
  const bb = B(big), tb = B(txt);
  const out = {
    big: bb, txt: tb,
    // 说明文字实际占几行（高度 / 行高）
    txtLines: tb.h > 0 ? Math.round(tb.h / (parseFloat(getComputedStyle(txt).lineHeight) || 20)) : 0,
    txtText: (txt.textContent || '').trim().slice(0, 60),
    sameTop: Math.abs(bb.t - tb.t) < 8,
    bigLeftOfTxt: bb.r <= tb.l + 1
  };
  if (tgt) {
    const gb = B(tgt);
    out.tgt = gb;
    out.tgtText = (tgt.textContent || '').trim().slice(0, 40);
    const overlap = (a, c) => {
      const ix = Math.min(a.r, c.r) - Math.max(a.l, c.l);
      const iy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      return { ix: Math.round(ix), iy: Math.round(iy), hit: ix > 0 && iy > 0 };
    };
    out.ovTxtTgt = overlap(tb, gb);
    out.ovBigTgt = overlap(bb, gb);
    out.tgtAtRight = gb.r >= tb.r;
  }
  // 滑条是否被压住
  const scale = document.querySelector('.ac-tier-wrap .tier-scale');
  if (scale) {
    const sr = scale.getBoundingClientRect();
    out.scaleBox = { t: Math.round(sr.top), b: Math.round(sr.bottom), h: Math.round(sr.height) };
    out.scaleHits = [[0.1, 0.3], [0.5, 0.5], [0.9, 0.7]].map(([fx, fy]) => {
      const el = document.elementFromPoint(sr.left + sr.width * fx, sr.top + sr.height * fy);
      return !!(el && (el === scale || scale.contains(el)));
    }).every(Boolean);
    // 滑条与读数行是否重叠（理论上不该）
    out.ovScaleRead = (() => {
      const rb = txt.getBoundingClientRect();
      const iy = Math.min(sr.bottom, rb.bottom) - Math.max(sr.top, rb.top);
      return Math.round(iy);
    })();
  }
  // 整个 wrap 内有没有元素溢出到 wrap 之外（"看着糊住"的一个常见来源）
  const wrap = document.querySelector('.ac-tier-wrap');
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    out.escapes = [...wrap.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return r.bottom > wr.bottom + 1 || r.top < wr.top - 1;
    }).map((el) => ({ cls: String(el.className || el.tagName).slice(0, 30), top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) }));
    out.wrapBox = { t: Math.round(wr.top), b: Math.round(wr.bottom) };
  }
  return out;
})()`;

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  // ⚠️ 用 waitFor 而不是固定 sleep（2026-10-04 修）：
  //    启动默认落在「仪表盘」，而它的 /api/usage/stats 冷启动要 5 秒多。
  //    固定 sleep(2700) 之后设置页可能还没渲染完，`.settings-menu-item` 点不到，
  //    于是量到的全是"三部分都不存在" —— 看着像布局坏了，其实只是没到那一步。
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
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '导航渲染' });
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="chat"]')`, { timeout: 25000, label: '设置菜单' });
  await page.click('.settings-menu-item[data-section="chat"]');
  // ⚠️ 峰谷滑条在「活跃设置」折叠卡**内部**，卡关闭时整块 display:none。
  //    必须先把卡展开、再等滑条真的有尺寸 —— 只等选择器存在是不够的
  //    （元素在 display:none 子树里时选择器照样能命中，但量不到任何几何）。
  await page.waitFor(`document.getElementById('card-active-config')`, { timeout: 20000, label: '活跃设置卡' });
  await page.eval(`(() => {
    const card = document.getElementById('card-active-config');
    if (card && !card.classList.contains('open')) {
      const h = card.querySelector('.fold-head'); if (h) h.click();
    }
    return 1;
  })()`);
  await page.waitFor(`(() => {
    const s = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    return r.width > 100 && r.height > 10;
  })()`, { timeout: 20000, label: '峰谷滑条可见' });

  const check = (label, r) => {
    if (r.missing) { ok(`[${label}] 读数行三部分都存在`, false, JSON.stringify(r)); return; }
    console.log(`\n[${label}] 说明「${r.txtText}」${r.txtLines} 行；当前编辑「${r.tgtText || '(空)'}」`);
    console.log(`  档位数字  x ${r.big.l}~${r.big.r}  y ${r.big.t}`);
    console.log(`  说明文字  x ${r.txt.l}~${r.txt.r}  y ${r.txt.t}~${r.txt.b}`);
    if (r.tgt) console.log(`  当前编辑  x ${r.tgt.l}~${r.tgt.r}  y ${r.tgt.t}~${r.tgt.b}`);
    ok(`[${label}] 档位数字与说明在同一行顶对齐`, r.sameTop && r.bigLeftOfTxt, `sameTop=${r.sameTop} bigLeftOfTxt=${r.bigLeftOfTxt}`);
    if (r.tgt) {
      ok(`[${label}] 说明与「当前编辑」不重叠`, r.ovTxtTgt.hit === false,
        `水平交叠 ${r.ovTxtTgt.ix}px / 垂直交叠 ${r.ovTxtTgt.iy}px`);
      ok(`[${label}] 档位数字与「当前编辑」不重叠`, r.ovBigTgt.hit === false,
        `水平交叠 ${r.ovBigTgt.ix}px`);
      ok(`[${label}] 「当前编辑」在最右`, r.tgtAtRight === true, `右缘 ${r.tgt.r} ≥ ${r.txt.r}`);
    }
    ok(`[${label}] 滑条没有被任何东西压住`, r.scaleHits === true, '');
    ok(`[${label}] 读数行不与滑条重叠`, r.ovScaleRead <= 0, `垂直交叠 ${r.ovScaleRead}px`);
    ok(`[${label}] 没有元素溢出读数区`, (r.escapes || []).length === 0,
      (r.escapes || []).map((e) => `${e.cls}(${e.top}~${e.bottom} vs ${r.wrapBox.t}~${r.wrapBox.b})`).join(' '));
  };

  // ── 单档模式 ─────────────────────────────────────────────────────────
  await page.eval(`(() => {
    const c = document.getElementById('ac-peak-enabled');
    if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }
    return 1;
  })()`);
  await sleep(1200);
  check('单档模式', await page.eval(MEASURE));

  // ── 峰谷双点模式（读数两行 —— 上一版出问题的场景）──────────────────────
  await page.eval(`(() => {
    const c = document.getElementById('ac-peak-enabled');
    if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
    return 1;
  })()`);
  await sleep(1400);
  const dual = await page.eval(MEASURE);
  check('峰谷双点模式', dual);
  ok('峰谷模式下说明确实是两行（本轮问题场景已复现）', dual.txtLines >= 2, `${dual.txtLines} 行`);

  await page.screenshot('shots/final/readout-' + (await page.eval('document.documentElement.getAttribute("data-theme")')) + '.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n读数行布局正常（单档与峰谷双点两种模式）。');
process.exit(failed ? 2 : 0);
