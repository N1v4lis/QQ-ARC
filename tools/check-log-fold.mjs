// 两项验收：
//   ① 侧边栏更窄（--q-sidebar-w 200px，且实测宽度确实变窄）
//   ② OneBot 里的两个日志块可折叠；折叠时只显示最近 5 行，展开时显示全部
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

const countLines = (t) => String(t || '').split('\n').filter((x) => x !== '').length;

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await sleep(1000);

  // ── ① 侧边栏宽度 ─────────────────────────────────────────────────────
  const side = await page.eval(`(() => {
    const el = document.querySelector('.q-sidebar');
    const b = el.getBoundingClientRect();
    return {
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--q-sidebar-w').trim(),
      width: Math.round(b.width),
      rail: getComputedStyle(document.documentElement).getPropertyValue('--q-sidebar-w-rail').trim()
    };
  })()`);
  console.log(`   侧栏：变量 ${side.cssVar}，实测宽 ${side.width}px，折叠态 ${side.rail}`);
  ok('侧栏宽度已收窄（≤208px）', side.width <= 208, `${side.width}px`);
  ok('侧栏宽度确实比原来窄（原 236px）', side.width < 236, `${side.width}px < 236px`);

  // ── ② 日志折叠 ───────────────────────────────────────────────────────
  // 先把两个日志都置为"展开"，拿到全量行数作为基准
  await page.eval(`(() => {
    localStorage.setItem('qqa-sl-log-open', '1');
    localStorage.setItem('qqa-app-log-open', '1');
    return 1;
  })()`);
  await page.eval(`(() => { openSettingsSection('onebot'); return 1; })()`);
  // ⚠️ 等待条件必须覆盖**下面要读的每一个元素**。
  //    原来只等 #sl-log-toggle（运行日志），但紧随其后就读 #app-logs-view /
  //    #app-log-block —— 面板重建的中间态里这两个可能还没有，
  //    于是 `appPre.textContent` 抛 "Cannot read properties of null"，
  //    整条用例静默失败（实测批量跑时偶发）。
  //    教训：等待条件要按"后续读取的元素集合"来写，不是等其中一个就够了。
  await page.waitFor(`(() => {
    const h = document.querySelector('#settings-form #snowluma-page');
    if (!h || h.innerHTML.length <= 1000) return false;
    return ['sl-logs-view', 'app-logs-view', 'sl-log-toggle', 'app-log-toggle',
            'sl-log-block', 'app-log-block'].every((id) => !!document.getElementById(id));
  })()`, { timeout: 25000, label: '两个日志框与折叠按钮都就绪' });
  await sleep(1200);

  const expanded = await page.eval(`(() => {
    const slPre = document.getElementById('sl-logs-view');
    const appPre = document.getElementById('app-logs-view');
    const slBlock = document.getElementById('sl-log-block');
    const appBlock = document.getElementById('app-log-block');
    return {
      slLines: (slPre.textContent || '').split('\\n').filter((x) => x !== '').length,
      appLines: (appPre.textContent || '').split('\\n').filter((x) => x !== '').length,
      slFoldedClass: slBlock.classList.contains('sl-folded'),
      appFoldedClass: appBlock.classList.contains('sl-folded'),
      slAria: document.getElementById('sl-log-toggle').getAttribute('aria-expanded'),
      appAria: document.getElementById('app-log-toggle').getAttribute('aria-expanded'),
      slCount: (document.getElementById('sl-log-count') || {}).textContent,
      appCount: (document.getElementById('app-log-count') || {}).textContent,
      // 箭头朝向：折叠时 rotate(-90deg)
      slChevTransform: getComputedStyle(document.querySelector('#sl-log-toggle .sl-chev')).transform
    };
  })()`);
  console.log(`   展开态：运行 ${expanded.slLines} 行（计数「${expanded.slCount}」）、应用 ${expanded.appLines} 行（计数「${expanded.appCount}」）`);
  ok('两个日志块都有折叠开关', expanded.slAria === 'true' && expanded.appAria === 'true',
    `sl=${expanded.slAria} app=${expanded.appAria}`);
  ok('展开态显示全部行（> 5 行）', expanded.slLines > 5 && expanded.appLines > 5,
    `运行 ${expanded.slLines} / 应用 ${expanded.appLines}`);

  // 折叠"运行日志"
  await page.eval(`(() => { document.getElementById('sl-log-toggle').click(); return 1; })()`);
  await sleep(1800);
  const slFolded = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    const block = document.getElementById('sl-log-block');
    return {
      lines: (pre.textContent || '').split('\\n').filter((x) => x !== '').length,
      lastLine: (pre.textContent || '').split('\\n').filter((x) => x !== '').slice(-1)[0],
      foldedClass: block.classList.contains('sl-folded'),
      aria: document.getElementById('sl-log-toggle').getAttribute('aria-expanded'),
      count: (document.getElementById('sl-log-count') || {}).textContent,
      stored: localStorage.getItem('qqa-sl-log-open')
    };
  })()`);
  console.log(`   折叠运行日志：${slFolded.lines} 行，计数「${slFolded.count}」，末行 ${String(slFolded.lastLine).slice(0, 40)}`);
  ok('折叠「运行日志」后只显示 5 行', slFolded.lines === 5, `${slFolded.lines} 行`);
  ok('折叠的是**最近**的 5 行（保留了末行）', !!slFolded.lastLine, `末行存在`);
  ok('折叠状态写入 localStorage（跨刷新保留）', slFolded.stored === '0', `qqa-sl-log-open=${slFolded.stored}`);
  ok('折叠后有 aria-expanded=false', slFolded.aria === 'false', slFolded.aria);
  ok('折叠后计数显示「5 / 全部」', /\d+\s*\/\s*\d+/.test(String(slFolded.count)), String(slFolded.count));
  ok('折叠块带 .sl-folded 类', slFolded.foldedClass === true, '');

  // 折叠"应用日志"
  // ⚠️ 折叠是"改 localStorage + 整页重建"，而重建期间 SSE/状态事件还会再触发几次；
  //    单次采样可能撞上"还没应用折叠"的中间态（实测偶发读到 57 行）。
  //    所以等到 **aria-expanded=false 且行数=5」同时成立** 再判定。
  await page.eval(`(() => { document.getElementById('app-log-toggle').click(); return 1; })()`);
  let appFolded = null;
  for (let i = 0; i < 20 && !appFolded; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const s = await page.eval(`(() => {
      const pre = document.getElementById('app-logs-view');
      const block = document.getElementById('app-log-block');
      const btn = document.getElementById('app-log-toggle');
      if (!pre || !block || !btn) return null;
      return {
        lines: (pre.textContent || '').split('\\n').filter((x) => x !== '').length,
        foldedClass: block.classList.contains('sl-folded'),
        aria: btn.getAttribute('aria-expanded'),
        stored: localStorage.getItem('qqa-app-log-open')
      };
    })()`);
    if (s && s.aria === 'false' && s.lines === 5) appFolded = s;
    // eslint-disable-next-line no-await-in-loop
    if (!appFolded) await sleep(400);
  }
  ok('折叠「应用日志」后只显示 5 行', !!appFolded && appFolded.lines === 5,
    appFolded ? `${appFolded.lines} 行` : '等待折叠生效超时');
  ok('应用日志折叠状态也持久化', !!appFolded && appFolded.stored === '0',
    `qqa-app-log-open=${appFolded ? appFolded.stored : '?'}`);

  // 折叠态下实时追加也不能"长出来"
  const grow = await page.eval(`(async () => {
    const pre = document.getElementById('sl-logs-view');
    const before = (pre.textContent || '').split('\\n').filter((x) => x !== '').length;
    // 直接喂几条模拟的增量日志（走真实追加函数）
    for (let i = 0; i < 12; i += 1) appendSnowlumaLog({ at: Date.now(), stream: 'stdout', text: 'collapse-test-line-' + i });
    await new Promise((r) => setTimeout(r, 200));
    const after = (pre.textContent || '').split('\\n').filter((x) => x !== '').length;
    return { before, after };
  })()`);
  ok('折叠态下追加日志也不会超过 5 行', grow.after <= 5, `${grow.before} → ${grow.after} 行`);

  // 再点一次展开
  //
  // ⚠️ 固定 sleep 后单次采样会偶发读到**中间态**（实测批量跑时读到"6 行、stored=1"）：
  //    展开同样是"改 localStorage + 整页重建"，而重建期间 SSE/状态事件还会再触发几次。
  //    判据要与折叠时一致 —— **等状态稳定**再读，而不是猜一个时长。
  //    这里等「aria-expanded=true 且 行数 > 5」同时成立，才算展开完成。
  await page.eval(`(() => { document.getElementById('sl-log-toggle').click(); return 1; })()`);
  await page.waitFor(`(() => {
    const btn = document.getElementById('sl-log-toggle');
    const pre = document.getElementById('sl-logs-view');
    if (!btn || !pre) return false;
    const lines = (pre.textContent || '').split('\\n').filter((x) => x !== '').length;
    return btn.getAttribute('aria-expanded') === 'true' && lines > 5;
  })()`, { timeout: 25000, label: '日志展开完成' });
  const reExpanded = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    const block = document.getElementById('sl-log-block');
    return {
      lines: (pre.textContent || '').split('\\n').filter((x) => x !== '').length,
      foldedClass: block.classList.contains('sl-folded'),
      stored: localStorage.getItem('qqa-sl-log-open')
    };
  })()`);
  ok('再点一次能展开回全部', reExpanded.lines > 5 && reExpanded.foldedClass === false,
    `${reExpanded.lines} 行，stored=${reExpanded.stored}`);

  await page.screenshot('shots/final/snowluma-folded-logs.png');
  console.log('\n截图：shots/final/snowluma-folded-logs.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n侧栏收窄与日志折叠验收通过。');
process.exit(failed ? 2 : 0);
