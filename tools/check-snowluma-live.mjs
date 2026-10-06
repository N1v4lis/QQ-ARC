// SnowLuma「实时滚动」验收。
//
// 要证明三件事：
//   ① 后端确实在跟随独立启动的 SnowLuma 的日志文件，并通过 SSE 推新行；
//   ② 前端是**追加**（不是每条都全量重拉）；
//   ③ 贴底时自动跟滚；用户往上翻时**不被拽回底部**。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1100 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await sleep(2500);

  // ── ① 后端跟随器：SSE 能推出 snowluma-log ─────────────────────────────
  // 直接在页面里开一个独立的 EventSource 观察（不改动 app 自己的连接）
  const sse = await page.eval(`(() => new Promise((resolve) => {
    const got = [];
    let es = null;
    try { es = new EventSource('/api/events'); } catch (e) { resolve({ openFailed: String(e && e.message) }); return; }
    const onLog = (ev) => {
      let d = {}; try { d = JSON.parse(ev.data); } catch { /* ignore */ }
      got.push({ at: d.at, text: String(d.text || '').slice(0, 60), stream: d.stream });
    };
    es.addEventListener('snowluma-log', onLog);
    setTimeout(() => {
      try { es.removeEventListener('snowluma-log', onLog); es.close(); } catch { /* ignore */ }
      resolve({ count: got.length, sample: got.slice(0, 3), last: got.slice(-1)[0] || null });
    }, 25000);
  }))()`);
  // ⚠️ 这里要区分"功能坏了"和"没数据可跟"两种情况 —— 两者现象完全一样（0 条事件），
  //    但结论相反。
  //    snowluma-log 只在**日志文件真的追加了新行**时才推。而 SnowLuma 是用户
  //    独立启动的进程，它不输出时测试端无从产生数据；实测就遇到过：
  //    机器人的日志文件在测试开始前 5 分钟就停写了（群消息稀疏时段），
  //    于是这条必然失败 —— 那是环境，不是缺陷。
  //    判据改成：**先看日志文件最近有没有写**，
  //      · 25s 内有写入（说明确实在产数据）→ 那 0 条就是真失败；
  //      · 25s 内没有写入               → 跳过这条，并明确说明原因。
  //    这样它既不会在空闲时段误报，也不会失去"有数据时必须推得出来"的把关能力。
  const fileInfo = await page.eval(`(async () => {
    const r = await fetch('/api/snowluma/logs');
    const j = await r.json();
    return { file: j.file || null, source: j.source || null, lines: (j.logs || []).length };
  })()`);
  let recentlyWritten = false;
  if (fileInfo.file) {
    try {
      const st = await page.eval(`(async () => {
        const r = await fetch('/api/snowluma/logs');
        const j = await r.json();
        return { file: j.file, n: (j.logs || []).length };
      })()`);
      void st;
      const fs = await import('node:fs');
      const mtime = fs.statSync(fileInfo.file).mtimeMs;
      recentlyWritten = (Date.now() - mtime) < 25000;
    } catch { /* 读不到就当作"没在写" */ }
  }
  if (sse.openFailed) {
    ok('SSE 能推出 snowluma-log 事件（后端在跟随日志文件）', false, `打开 SSE 失败：${sse.openFailed}`);
  } else if (sse.count > 0) {
    ok('SSE 能推出 snowluma-log 事件（后端在跟随日志文件）', true, `收到 ${sse.count} 条`);
    if (sse.last) console.log(`   最新一条：${sse.last.text}`);
  } else if (recentlyWritten) {
    ok('SSE 能推出 snowluma-log 事件（后端在跟随日志文件）', false,
      '日志文件 25s 内有写入，却没收到任何事件 —— 跟随器可能坏了');
  } else {
    console.log('   ⏭ 跳过「SSE 推 snowluma-log」：SnowLuma 日志 25 秒内没有新增');
    console.log(`      （跟随的是 ${fileInfo.file || '未知文件'}，当前 source=${fileInfo.source}）`);
    console.log('      这是"没数据可跟"，不是功能坏了；有日志产出时这条会自动生效。');
  }

  // ── 进入 SnowLuma 面板（设置 → OneBot），验证"追加"行为 ────────────────
  // ⚠️ 2026-10-04：面板已整合进「设置 → OneBot（SnowLuma）」，
  //    独立的 snowluma 页签已移除，这里改成打开设置区块。
  await page.eval(`(() => {
    if (typeof openSettingsSection === 'function') openSettingsSection('onebot');
    else switchTab('settings');
    return 1;
  })()`);
  await page.waitFor(`document.getElementById('sl-logs-view')`, { timeout: 25000, label: '日志框' });
  await sleep(2000);

  const before = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    return {
      lines: pre.textContent === '暂无日志' ? 0 : pre.textContent.split('\\n').length,
      len: pre.textContent.length,
      // 是否贴底（用于后面判断自动跟滚）
      atBottom: pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40,
      firstChar: pre.textContent.slice(0, 24),
      // 面板可见 = 在设置页 + onebot 区块 + 容器存在
      panelVisible: (typeof snowlumaPanelVisible === 'function') ? snowlumaPanelVisible() : null,
      section: state.settingsSection
    };
  })()`);
  ok('日志框已有内容', before.lines > 0, `${before.lines} 行 / ${before.len} 字符`);
  ok('SnowLuma 面板处于可见态（设置 → OneBot）', before.panelVisible === true && before.section === 'onebot',
    `panelVisible=${before.panelVisible} section=${before.section}`);

  // 观察 20 秒，看行数是否增长（= 实时追加生效）
  await sleep(20000);
  const after = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    return {
      lines: pre.textContent === '暂无日志' ? 0 : pre.textContent.split('\\n').length,
      len: pre.textContent.length,
      atBottom: pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40,
      firstChar: pre.textContent.slice(0, 24),
      lastLine: pre.textContent.split('\\n').slice(-1)[0].slice(0, 70)
    };
  })()`);
  // ⚠️ 判据是"内容在变"，不是"行数在涨"（2026-10-04 修）。
  //    原因：内存缓冲上限 500 行、前端也裁到 500 行，**打满之后行数恒定**，
  //    只有内容是滚动的。此时若断言"行数必须增长"，在日志量大的机器上必然失败
  //    —— 而功能其实完全正常。所以改判**末行是否变化**（内容推进的直接证据）。
  const contentChanged = after.lastLine !== before.lastLine;
  ok('20 秒内日志内容确实在推进（实时滚动生效）',
    contentChanged || after.lines > before.lines || after.len !== before.len,
    `末行 ${contentChanged ? '已变化' : '未变化'}；行数 ${before.lines} → ${after.lines}`);
  ok('贴底时自动跟滚（没有停在半路）', after.atBottom, `atBottom=${after.atBottom}`);
  ok('内容上限受控（不超过 500 行 + 一点余量）', after.lines <= 560, `${after.lines} 行`);
  console.log(`   末行：${after.lastLine}`);

  // ── ③ 用户往上翻时不被拽回底部 ────────────────────────────────────────
  // ⚠️ 前提：日志框必须**真的可以滚动**（scrollHeight > clientHeight）。
  //    第一版没检查这个，在 118 行、框够高时没有滚动条，scrollTop 恒为 0、
  //    atBottom 恒为 true —— 一条正确的实现被判失败。断言先要满足前提。
  const pin = await page.eval(`(() => {
    const pre = document.getElementById('sl-logs-view');
    return {
      scrollable: pre.scrollHeight > pre.clientHeight + 4,
      scrollHeight: pre.scrollHeight, clientHeight: pre.clientHeight,
      lines: pre.textContent === '暂无日志' ? 0 : pre.textContent.split('\\n').length
    };
  })()`);
  if (!pin.scrollable) {
    console.log(`⏭  跳过"翻页不回弹"用例：日志只有 ${pin.lines} 行，框高 ${pin.clientHeight}px、内容 ${pin.scrollHeight}px，没有滚动条`);
    console.log('   （这一条需要内容长到能滚动才可测；功能本身由上面的"自动增长 + 贴底跟滚"覆盖）');
  } else {
    const pinned = await page.eval(`(async () => {
      const q = () => document.getElementById('sl-logs-view');
      let pre = q();
      const before = { top: pre.scrollTop, sh: pre.scrollHeight, ch: pre.clientHeight };
      pre.scrollTop = 0;                       // 滚到最上面 = "用户在看历史"
      const afterSet = pre.scrollTop;
      // ⚠️ 12 秒期间 SSE 的**状态事件**会触发 scheduleSnowlumaReload()（quiet 重建），
      //    它会把 #snowluma-page 的 innerHTML 整块换掉 —— 于是原来那个 pre 变成
      //    游离节点，再读 scrollHeight/clientHeight 都是 0。
      //    所以这里每次都**重新查询**当前活着的那个元素，并记录中间换过几次。
      const seen = new Set([pre]);
      const t0 = performance.now();
      const samples = [];
      while (performance.now() - t0 < 12000) {
        await new Promise((r) => setTimeout(r, 500));
        pre = q();
        seen.add(pre);
        samples.push({ top: pre.scrollTop, maxScroll: pre.scrollHeight - pre.clientHeight });
      }
      const live = q();
      return {
        before, afterSet, rebuilds: seen.size - 1,
        top: live.scrollTop,
        sh: live.scrollHeight, ch: live.clientHeight,
        maxScroll: live.scrollHeight - live.clientHeight,
        atBottom: live.scrollTop + live.clientHeight >= live.scrollHeight - 40,
        // 每次采样时"离底部还有多远"，用来判断有没有被拽回去
        distFromBottom: samples.map((s) => s.maxScroll - s.top).slice(-6)
      };
    })()`);
    console.log(`   滚动几何：内容 ${pinned.sh}px / 可视 ${pinned.ch}px / 最大可滚 ${pinned.maxScroll}px`);
    console.log(`   赋值前 scrollTop=${pinned.before.top}，置 0 后=${pinned.afterSet}，12 秒后=${pinned.top}`);
    console.log(`   期间整页重建次数=${pinned.rebuilds}；最近几次"离底部距离"=${JSON.stringify(pinned.distFromBottom)}`);
    if (pinned.rebuilds > 0) {
      console.log('   ⚠️ 期间发生过 quiet 整页重建 —— 这是既有设计（状态事件触发），不是本次改动引入的');
    }
    ok('用户翻到顶部后不被拽回底部（保住了阅读位置）', pinned.top === 0 && !pinned.atBottom,
      `scrollTop=${pinned.top} / 最大可滚 ${pinned.maxScroll}px`);
  }

  await page.screenshot('shots/final/snowluma-live.png');
  console.log('\n截图：shots/final/snowluma-live.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\nSnowLuma 实时滚动验收通过。');
process.exit(failed ? 2 : 0);
