// SnowLuma「运行日志」验收。
//
// 背景（2026-10-04 修）：该面板只显示后端**内存缓冲**（仅捕获由本进程 spawn 的
// SnowLuma 输出）。SnowLuma 独立启动时缓冲永远是空的 → 面板恒显示"暂无日志"，
// 而磁盘上其实有几十 MB 真实日志。
// 现在后端在缓冲为空时回退读 <snowluma>/logs/snowluma-YYYY-MM-DD.log 的尾部。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1100 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await sleep(3000);

  // ── 后端：日志接口应能给出内容（内存或文件回退），并标明来源 ──────────
  const api = await page.eval(`(async () => {
    const t0 = performance.now();
    const r = await fetch('/api/snowluma/logs', { headers: { 'x-console-token': CONSOLE_MARKER } });
    const j = await r.json();
    return {
      ms: Math.round(performance.now() - t0),
      ok: r.ok,
      source: j.source || null,
      file: j.file || null,
      count: (j.logs || []).length,
      hasAt: (j.logs || []).slice(0, 5).every((l) => typeof l.at === 'number' && l.at > 0),
      hasText: (j.logs || []).slice(0, 5).every((l) => typeof l.text === 'string' && l.text.length > 0),
      sample: ((j.logs || []).slice(-1)[0] || {}).text || ''
    };
  })()`);
  ok('日志接口返回 200', api.ok, `耗时 ${api.ms}ms`);
  // 阈值 4000ms：足够宽松以吸收磁盘 / 批量回归时的抖动，
  // 但仍能抓住"把几十 MB 文件整读一遍"那种病态实现（那会是数秒到十几秒）。
  // 实测常态 11~40ms，批量跑偶尔到 2.4s（磁盘争用），不是功能问题。
  ok('接口响应要快（只读尾部，不整读几十 MB 文件）', api.ms < 4000, `${api.ms}ms`);
  ok('返回了日志内容（不再恒为空）', api.count > 0, `条数 ${api.count}，来源 ${api.source}${api.file ? ' / ' + api.file : ''}`);
  ok('每条都带数字时间戳（前端才能正确排序/显示）', api.hasAt, JSON.stringify(api));
  ok('每条都带文本', api.hasText, '');
  ok('来源被标明（memory=实时输出 / file=日志文件）',
    api.source === 'memory' || api.source === 'file', `source=${api.source}`);

  // ── 前端：运行日志框不该是"暂无日志"，且不重复时间戳 ─────────────────
  // ⚠️ 2026-10-04：SnowLuma 面板已整合进「设置 → OneBot（SnowLuma）」，
  //    原来点的是 `#tabs .tab[data-tab="snowluma"]`，那个页签已经不存在了。
  //    改成打开对应设置区块。
  await page.eval(`(() => {
    if (typeof openSettingsSection === 'function') openSettingsSection('onebot');
    else switchTab('settings');
    return 1;
  })()`);
  await page.waitFor(`document.getElementById('sl-logs-view')`, { timeout: 25000, label: 'SnowLuma 日志框' });
  await sleep(2500);

  const ui = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    const box = document.getElementById('snowluma-page');
    const head = box ? box.querySelector('.sl-log-head') : null;
    const txt = pre ? (pre.textContent || '') : '';
    const first = txt.split('\\n')[0] || '';
    return {
      exists: !!pre,
      none: txt.trim() === '暂无日志',
      len: txt.length,
      lines: txt ? txt.split('\\n').length : 0,
      first: first.slice(0, 90),
      // 时间戳重复的表现：方括号时间戳后又跟一个 HH:MM:SS
      // ⚠️ 注释里不要写反引号 —— 这段是 JS 模板字符串，反引号会把字符串提前截断
      //    （报 "Unexpected token ':'"），而且报错位置看着像正则的问题。
      dupTs: /^\\[\\d{1,2}:\\d{2}:\\d{2}\\]\\s*\\d{1,2}:\\d{2}:\\d{2}/.test(first),
      headText: head ? head.textContent.replace(/\\s+/g, ' ').trim() : '',
      pageLen: box ? box.innerHTML.length : -1
    };
  })()`);
  ok('页面渲染出来了（不是空白）', ui.pageLen > 1000, `${ui.pageLen} 字节`);
  ok('运行日志框存在', ui.exists, '');
  ok('运行日志框不再是「暂无日志」', !ui.none && ui.len > 0, `长度 ${ui.len}，${ui.lines} 行`);
  ok('行首没有重复的时间戳', !ui.dupTs, `首行：「${ui.first}」`);
  ok('标题里标明了日志来源', /来自日志文件|实时输出/.test(ui.headText), ui.headText.slice(0, 70));

  await page.screenshot('shots/final/snowluma-logs.png');
  console.log('\n截图：shots/final/snowluma-logs.png');
  console.log(`首页行样例：${ui.first}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\nSnowLuma 运行日志验收通过。');
process.exit(failed ? 2 : 0);
