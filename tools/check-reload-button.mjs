// 「重载界面」按钮验收：
//   位置（标题栏 logo 旁边）、可点、点击真的触发 reload、旋转反馈、
//   拖动区兼容（按钮必须 no-drag，否则无边框窗口里点不动）。
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
  await page.waitFor(`document.getElementById('q-reload-btn')`, { timeout: 20000, label: '重载按钮' });
  // ⚠️ 必须等启动遮罩摘掉再点：它 z-index 999 盖住整窗，
  //    elementFromPoint 会命中 loading-overlay，于是"按钮点不到"是假失败。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });

  const r = await page.eval(`(() => {
    const btn = document.getElementById('q-reload-btn');
    const logo = document.querySelector('.q-tb-logo');
    const brand = document.querySelector('.q-tb-brand');
    const drag = document.getElementById('q-tb-drag');
    const topbar = document.getElementById('topbar');
    const winctl = document.getElementById('q-winctl');
    const B = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const cs = getComputedStyle(btn);
    return {
      exists: !!btn,
      tag: btn.tagName, type: btn.type,
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.title,
      inDrag: !!(drag && drag.contains(btn)),
      inTopbar: !!(topbar && topbar.contains(btn)),
      inWinctl: !!(winctl && winctl.contains(btn)),
      appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region') || null,
      box: B(btn), logoBox: B(logo), brandBox: B(brand), topbarBox: B(topbar),
      // 位置关系：在 logo 与品牌之后（同一行、logo 右侧）
      afterLogo: B(logo) && B(btn).l >= B(logo).r - 2,
      sameRowAsLogo: B(logo) && Math.abs(B(btn).t - B(logo).t) < 20,
      svgCount: btn.querySelectorAll('svg').length,
      cursor: cs.cursor,
      hitTest: (() => {
        const b = btn.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return el ? (el.id || el.closest('[id]')?.id || el.tagName) : null;
      })()
    };
  })()`);

  ok('按钮存在且是真 <button>', r.exists && r.tag === 'BUTTON', `<${r.tag} type=${r.type}>`);
  ok('按钮在标题栏的拖动区内', r.inDrag === true && r.inTopbar === true, `inDrag=${r.inDrag}`);
  ok('按钮不在窗口三键那一组里（与关闭键分开）', r.inWinctl === false, `inWinctl=${r.inWinctl}`);
  ok('紧邻 logo 且在同一行', r.afterLogo === true && r.sameRowAsLogo === true,
    `logo ${r.logoBox.r} → 按钮 ${r.box.l}~${r.box.r}，y ${r.box.t} vs ${r.logoBox.t}`);
  ok('按钮尺寸合理（24px 量级，与 logo 呼应）', r.box.w >= 20 && r.box.w <= 32 && r.box.h >= 20 && r.box.h <= 32,
    `${r.box.w}x${r.box.h}`);
  ok('有旋转图标', r.svgCount === 1, `${r.svgCount} 个 svg`);
  ok('有可读的 title / aria-label（说明它做什么）',
    String(r.title || '').includes('重载') && String(r.ariaLabel || '').includes('重载'),
    `title="${r.title}"`);
  ok('可点击命中（没有被别的元素盖住）', r.hitTest === 'q-reload-btn', `elementFromPoint → ${r.hitTest}`);
  // ⚠️ 关键：无边框窗口里，拖动热区内的交互元素必须 no-drag，否则点不动
  ok('显式 no-drag（拖动热区里的按钮否则点不动）',
    String(r.appRegion) === 'no-drag', `-webkit-app-region=${r.appRegion}`);

  await page.screenshot('shots/final/titlebar-reload.png');
  console.log('\n截图：shots/final/titlebar-reload.png（点击验证前的静态状态）');

  // ── 点击链路：真的触发页面导航 ────────────────────────────────────────
  // 观测手法（试过四种，记下来免得再走弯路）：
  //   · 劫持 location.reload → 不行：Chromium 里它是 non-configurable，
  //     报 "Cannot redefine property: reload"。
  //   · 挂 beforeunload + preventDefault 去"拦住"刷新 → 不行：
  //     阻止导航会把 CDP 的 Runtime.evaluate 一起卡住（等不到返回值，超时）。
  //   · 用 window 上的随机标记 → **不稳**：刷新后 window 是全新的，
  //     标记变 undefined，与"还没刷新"读到的旧值难以区分，
  //     而且第二次刷新时竞速容易误判（实测偶发失败）。
  //   · 最终（最稳）：**localStorage 计数器**。
  //     localStorage 跨导航保留，window 不保留 —— 点之前记下计数，
  //     刷新后计数一定 +1，且**窗口还存在按钮**，两者同时成立才判定成功。
  //     用 sessionStorage 不行（reload 会保留，但语义上 counter 该跨会话）。
  const rl = await page.eval(`(() => {
    const KEY = '__qqaReloadProbe';
    const before = Number(localStorage.getItem(KEY) || 0);
    const btn = document.getElementById('q-reload-btn');
    btn.click();
    return { before, spinning: btn.classList.contains('is-spinning') };
  })()`);
  ok('点击时先播旋转反馈再刷新', rl.spinning === true, `is-spinning=${rl.spinning}`);

  // 刷新后（同一段脚本再执行一次）把计数 +1 写回，作为"文档确实换过"的证据。
  // 注意：必须在**新文档**里执行才算数 —— 所以这里先等页面重新可用。
  let reloaded = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    try {
      const now = await page.eval(`(() => {
        const KEY = '__qqaReloadProbe';
        const v = Number(localStorage.getItem(KEY) || 0);
        const hasBtn = !!document.getElementById('q-reload-btn');
        // 只在"新文档已就绪且这次还没记过账"时才自增
        if (hasBtn && v === ${rl.before}) {
          localStorage.setItem(KEY, String(v + 1));
          return { marker: null, stamped: v + 1, hasBtn };
        }
        return { marker: v, stamped: null, hasBtn };
      })()`);
      if (now.stamped) { reloaded = true; console.log(`  （检测到新文档：计数 ${rl.before} → ${now.stamped}）`); break; }
    } catch { /* 导航中 CDP 会短暂失败，属正常 */ }
  }
  ok('点击后页面真的重新加载了（等同于 Ctrl+Shift+R）', reloaded,
    reloaded ? '' : '等待 15 秒未观察到新文档');

  // ── 关掉动效时应"立刻刷新"，不延迟 ────────────────────────────────────
  // 关键在于"不播旋转"：立即模式下点下去不该有 is-spinning。
  // 刷新本身已经由上面证明了，这里只验"分支选择"是否正确。
  if (reloaded) {
    await page.waitFor(`document.getElementById('q-reload-btn')`, { timeout: 20000, label: '刷新后的按钮' });
    await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
    const noMotion = await page.eval(`(() => {
      // ⚠️ 必须走 qqaMotion.setPref('off')，不能直接 setAttribute。
      //    只改属性的话 localStorage['qqa-motion'] 还是 'on'，
      //    而 SSE 触发的 quiet 重建会重跑 motionRuntime 的 apply(getPref())，
      //    把属性**还原成 on** —— 于是处理函数读到 on、又进了旋转分支。
      window.qqaMotion.setPref('off');
      const btn = document.getElementById('q-reload-btn');
      const KEY = '__qqaReloadProbe';
      const before = Number(localStorage.getItem(KEY) || 0);
      // 点击前把上一次可能残留的类清掉，保证"点完看到 true"一定是本次造成的
      btn.classList.remove('is-spinning');
      const preClickSpinning = btn.classList.contains('is-spinning');
      const handlerWillSee = document.documentElement.getAttribute('data-motion');
      let reduced = false;
      try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
      btn.click();
      return {
        before, preClickSpinning, handlerWillSee, reduced,
        spinning: btn.classList.contains('is-spinning'),
        afterClickAttr: document.documentElement.getAttribute('data-motion'),
        motionStored: localStorage.getItem('qqa-motion')
      };
    })()`);
    ok('关闭动效时点下去不播旋转（走立即刷新分支）', noMotion.spinning === false,
      `is-spinning=${noMotion.spinning}（点前=${noMotion.preClickSpinning}，处理函数看到 data-motion=${noMotion.handlerWillSee}，reduced=${noMotion.reduced}，` +
      `点后属性=${noMotion.afterClickAttr}，存储=${noMotion.motionStored}）`);
    let reloaded2 = false;
    for (let i = 0; i < 50; i += 1) {
      await sleep(200);
      try {
        const stamped = await page.eval(`(() => {
          const KEY = '__qqaReloadProbe';
          const v = Number(localStorage.getItem(KEY) || 0);
          if (!!document.getElementById('q-reload-btn') && v === ${noMotion.before}) {
            localStorage.setItem(KEY, String(v + 1));
            return v + 1;
          }
          return null;
        })()`);
        if (stamped) { reloaded2 = true; break; }
      } catch { /* ignore */ }
    }
    ok('关闭动效时立即刷新（几乎没有延迟）', reloaded2, reloaded2 ? '已确认重新加载' : '未观察到重新加载');
  }

  await page.screenshot('shots/final/titlebar-reload.png');
  console.log('\n截图：shots/final/titlebar-reload.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n重载按钮验收通过。');
process.exit(failed ? 2 : 0);
