// 〔SnowLuma 页签〕——M9 拆分第 4 段
'use strict';
// ── SnowLuma 独立页签 ──
// ── 日志行格式化（两处共用，别再各写一份）────────────────────────────────
// 为什么单独抽出来：`refreshSnowlumaLogs()`（只刷日志区）和 `loadSnowlumaPage()`
// （整页重建）各有一份格式化代码。改一处漏一处的话，会出现
// "点刷新是这个样子、SSE 推来一条又变成另一个样子" 这种诡异现象。
//
// ⚠️ 从**日志文件**读来的行本身就带时间戳（`11:48:33 OK [..] ...`）——
//    后端在内存缓冲为空时会回退读文件（见 routes.js 的 /api/snowluma/logs）。
//    所以只在行首没有时间戳时才补 [HH:MM:SS] 前缀，否则会变成
//    `[11:48:33] 11:48:33 OK ...` 这种重复。
const LOG_LINE_HAS_TS = /^\s*\d{1,2}:\d{2}:\d{2}/;
function fmtLogLine(l) {
  const t = new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false });
  const body = String(l.text ?? '');
  const warn = l.stream === 'stderr';
  if (LOG_LINE_HAS_TS.test(body)) return `${warn ? '⚠ ' : ''}${body}`;
  return `[${t}]${warn ? ' ⚠' : ''} ${body}`;
}
function fmtLogLines(arr) {
  return (arr || []).map(fmtLogLine).join('\n') || '暂无日志';
}

// ── 增量追加（实时滚动）───────────────────────────────────────────────────
// 为什么不能"每来一条就 refreshSnowlumaLogs()"：
//   那样每次都重新拉 400 行、再整块替换 textContent —— 日志文件几十 MB 时
//   一秒一次的全量拉取纯属浪费，而且整块替换会让**用户正在往上翻的历史被重置**。
// 所以实时日志走"追加"：只在末尾粘一行，并按贴底状态决定要不要跟着滚。
//
// ── 日志区可折叠（2026-10-05 加，用户要求）────────────────────────────────
// 折叠时只显示**最近 5 行**，展开时显示全部（上限 500 行）。
//
// 为什么折叠用"只渲染 5 行"而不是"CSS 限高 + overflow:hidden"：
//   限高会让用户以为日志只有那几行、而且滚不动（视觉上像卡住）；
//   直接只给 5 行则语义清晰 —— "折叠态就是看最近几条"。
//   展开时再给全量，两者都是同一份数据切不同长度，不会丢内容。
//
// 状态存 localStorage 而不是 state：这是**用户偏好**（他习惯折叠还是展开），
// 应当跨刷新保留；放在 state 里每次刷新就丢了。
const SL_MAX_LINES = 500;          // 与后端"仅保留最近 500 行"一致
const SL_LOG_KEYS = { sl: 'qqa-sl-log-open', app: 'qqa-app-log-open' };
const SL_COLLAPSED_LINES = 5;
function slLogCollapsed(which) {
  try { return localStorage.getItem(SL_LOG_KEYS[which]) === '0'; } catch { return false; }
}
function setSlLogCollapsed(which, collapsed) {
  try { localStorage.setItem(SL_LOG_KEYS[which], collapsed ? '0' : '1'); } catch { /* 隐私模式忽略 */ }
}
/** 某个日志框当前最多显示几行（折叠 5 行 / 展开 500 行） */
function slLogLineLimit(which) {
  return slLogCollapsed(which) ? SL_COLLAPSED_LINES : SL_MAX_LINES;
}
/** 把整段日志文本裁到"最多 n 行"，保留**末尾**（最近的那几行） */
function slTrimLogTail(text, limit) {
  const lines = String(text || '').split('\n').filter((l) => l !== '');
  if (lines.length <= limit) return lines.join('\n');
  return lines.slice(-limit).join('\n');
}

function appendSnowlumaLog(line) {
  const box = $('#snowluma-page');
  if (!box) return;
  const pre = box.querySelector('#sl-logs-view');
  if (!pre) return;
  // 用户往上翻历史时不要拽他回底部 —— 先记贴底状态
  const wasAtBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40;

  // 折叠态下只保留最近 5 行：这里也按 limit 裁，否则追加几行后
  // 折叠框会悄悄长到 500 行（用户看到的"折叠"就失效了）。
  const limit = slLogLineLimit('sl');
  const lines = pre.textContent === '暂无日志' ? [] : pre.textContent.split('\n').filter((l) => l !== '');
  lines.push(fmtLogLine(line));
  if (lines.length > limit) lines.splice(0, lines.length - limit);
  pre.textContent = lines.join('\n');

  if (wasAtBottom) pre.scrollTop = pre.scrollHeight;   // 贴底时自动跟滚
}

/**
 * 只刷新日志区（不重建整个页面）。
 * SSE 每来一条新日志就调一次 —— 整页 innerHTML 重建会重绘、丢滚动、还拖帧。
 * 三个日志框各刷各的：QQ / SnowLuma / 应用。
 */
async function refreshSnowlumaLogs() {
  const box = $('#snowluma-page');
  if (!box) return;
  const slPre = box.querySelector('#sl-logs-view');
  const qqPre = box.querySelector('#qq-logs-view');
  const appPre = box.querySelector('#app-logs-view');
  if (!slPre && !qqPre && !appPre) return;   // 页面还没渲染过，等下次整页刷新
  try {
    const [logs, qqLogs, appLogsData] = await Promise.all([
      api('/api/snowluma/logs'),
      api('/api/qq-portable/logs').catch(() => ({ logs: [] })),
      api('/api/logs?limit=120').catch(() => ({ logs: [] }))
    ]);
    const setLog = (pre, text) => {
      if (!pre) return;
      // 先记贴底状态再换内容：往上翻历史时绝不把用户拽回底部
      const wasAtBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40;
      pre.textContent = text;
      if (wasAtBottom) pre.scrollTop = pre.scrollHeight;
    };
    // ⚠️ 折叠态下这里也必须裁到 5 行：否则 SSE 推几条日志后，
    //    折叠框会悄悄长到 500 行 —— 用户看到的"折叠"就失效了。
    setLog(slPre, slTrimLogTail(fmtLogLines(logs.logs), slLogLineLimit('sl')));
    setLog(qqPre, fmtLogLines(qqLogs.logs));
    if (appPre) {
      const appText = (appLogsData.logs || []).map((e) => {
        const t = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
        const lv = String(e.level || 'info').toUpperCase().padEnd(5);
        return `[${t}] [${lv}] [${e.module || '-'}] ${e.text}`;
      }).join('\n') || '暂无日志';
      setLog(appPre, slTrimLogTail(appText, slLogLineLimit('app')));
    }
  } catch { /* 刷新失败静默，不影响主流程 */ }
}

// 整页重建节流：状态事件可能连着来（启动 QQ + SnowLuma + OneBot），
// 不节流会连续三四次 Promise.all + innerHTML 重绘。
let slFullReloadTimer = null;
/** 加载序号：只认最后一次 loadSnowlumaPage 的结果（见该函数内的说明） */
let snowlumaLoadToken = 0;
function scheduleSnowlumaReload(opts = {}) {
  if (slFullReloadTimer) return;
  slFullReloadTimer = setTimeout(() => {
    slFullReloadTimer = null;
    loadSnowlumaPage({ quiet: true });
  }, 400);
}

/**
 * SnowLuma 面板当前是否**可见**。
 *
 * 2026-10-04：面板从独立页签整合进「设置 → OneBot（SnowLuma）」，
 * 于是"可见"的条件从 `state.tab === 'snowluma'` 变成
 * "在设置页 **且** 当前区块是 onebot"。
 *
 * 抽成函数是因为这个判断散在 SSE 处理器与事件回调里好几处 ——
 * 整合时如果只改一部分，会出现"日志不刷新 / 白刷"这种难以察觉的半坏状态。
 * 而且容器可能还没渲染出来（设置页只在 onebot 区块才挂它），所以要一并检查存在性。
 */
function snowlumaPanelVisible() {
  if (typeof state === 'undefined') return false;
  if (state.tab !== 'settings') return false;
  if ((state.settingsSection || 'api') !== 'onebot') return false;
  return !!document.getElementById('snowluma-page');
}

async function loadSnowlumaPage({ quiet = false } = {}) {
  // ⚠️ 只认最后一次加载（2026-10-04 加，与 loadDashboard / loadUsageView 同一套守卫）。
  //    面板整合进「设置 → OneBot」后，这个函数会在**每次设置页重渲染**时被调用
  //    （见 renderSettings 末尾），而设置页本身会因保存守卫 / SSE 状态事件反复重渲染。
  //    没有守卫时多个请求同时在飞：**先发的后到**，它的 innerHTML 会覆盖掉新一次的渲染，
  //    结果就是面板被清空 —— 表现为"进了 OneBot 区块但面板是空的"。
  //    实测：单独跑不出现、紧跟在会反复触发重渲染的套件之后必现。
  const token = ++snowlumaLoadToken;
  try {
    const [status, logs, qqLogs, appLogsData] = await Promise.all([
      api('/api/status'),
      api('/api/snowluma/logs'),
      api('/api/qq-portable/logs'),
      api('/api/logs?limit=120').catch(() => ({ logs: [], level: 'info' }))
    ]);
    // ⚠️ 过期结果的处理（2026-10-04 定稿）：**只要当前容器还是空的，就照常渲染**。
    //
    //    一开始写的是"过期就 return"，但那样会留下一个永久空白的可能：
    //    设置页会连续多次重渲染，每次渲染都作废上一次的加载；如果最后那次的
    //    容器又被换掉（或它自己也被作废），就再没有任何人把面板填上 ——
    //    实测约 2/3 概率出现"OneBot 区块在、面板空白"。
    //
    //    正确判据不是"我是不是最新的一次"，而是"**当前可见的容器里有没有内容**"：
    //      · 容器已有内容 → 让最新的那次去覆盖，本次丢弃（避免旧数据盖新数据）；
    //      · 容器是空的   → 本次照常渲染（救场）。稍后最新那次回来会再覆盖一次，
    //                        数据只是短暂旧一拍，反正 1 秒后 SSE 也会推新日志。
    //    ⚠️ 最终定稿（2026-10-04）：**不再丢弃任何能填上空白面板的结果**。
    //    之前写的是"过期就 return"，但设置页会连续多次重渲染、每次作废上一次，
    //    结果约 2/3 概率出现"OneBot 区块在、面板永久空白"（实测 hostLen=0）。
    //    现在只做两件事：
    //      ① 容器必须存在且 isConnected（否则写进去也看不见 —— 这是本轮定位最久的 bug：
    //         await 期间容器被换成新节点，我们写进了游离节点）；
    //      ② 容器已有内容、且本次是过期结果 → 丢弃（避免旧数据盖新数据）。
    //    容器空着就照常渲染 —— 谁填上都比空着强，稍后最新那次回来会再覆盖一遍。
    //    代价是面板可能被渲染两次（内容相同），并发场景下这点开销远小于"面板空白"。
    const live = document.getElementById('snowluma-page');
    if (!live || !live.isConnected) return;
    const s = status;
    const box = live;
    // 日志来源（后端在内存缓冲为空时会回退读 SnowLuma 的日志文件）。
    // 为什么要显示：内存缓冲只捕获"由本进程 spawn 的" SnowLuma 输出，
    // 独立启动的 SnowLuma 在这里永远是空的 —— 之前就一直显示"暂无日志"，
    // 而磁盘上其实有真实日志。标明来源后，用户能分清"真没日志"和"日志在文件里"。
    const logsSource = logs.source || (logs.logs && logs.logs.length ? 'memory' : 'none');
    const logsSourceLabel = logsSource === 'file'
      ? `来自日志文件 ${logs.file || ''}`
      : logsSource === 'memory' ? '实时输出'
      : logsSource === 'error' ? `读取失败：${logs.error || ''}` : '';
    const running = !!(s.snowluma?.running);
    const onebotConnected = !!s.onebot?.connected;
    const dir = s.snowluma?.dir || '';
    const embedded = !!s.snowluma?.embedded;
    const pid = s.snowluma?.pid ?? null;
    const webuiUrl = s.snowluma?.webuiUrl || '';
    // 便携 QQ 状态
    const qq = s.qqPortable || {};
    const qqReady = !!qq.ready;
    const qqRunning = !!qq.running;
    const qqPid = qq.pid ?? null;
    // ⚠️ 折叠态只渲染**最近 5 行**（用户要求）；展开态给全量（上限 500）。
    //    裁切放在这里（数据 → 文本的最后一步），下游的 pre / 滚动补偿 /
    //    计数都不用关心折叠与否 —— 它们拿到的永远是"该显示的那几行"。
    const logTextRaw = fmtLogLines(logs.logs);
    const logText = slTrimLogTail(logTextRaw, slLogLineLimit('sl'));
    const qqLogText = fmtLogLines(qqLogs.logs);
    // 应用日志（logger 的内存环形缓冲）
    const appLogs = appLogsData.logs || [];
    const appLogLevel = appLogsData.level || 'info';
    const appLogTextRaw = appLogs.map((e) => {
      const t = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
      const lv = String(e.level || 'info').toUpperCase().padEnd(5);
      return `[${t}] [${lv}] [${e.module || '-'}] ${e.text}`;
    }).join('\n') || '暂无日志';
    const appLogText = slTrimLogTail(appLogTextRaw, slLogLineLimit('app'));
    // 折行计数：告诉用户"现在显示几行 / 总共几行"，折叠时尤其必要
    // （否则只有 5 行会让人以为日志丢了）
    const countLines = (t) => String(t || '').split('\n').filter((x) => x !== '').length;
    const logLinesShown = countLines(logText);
    const logLinesTotal = countLines(logTextRaw);
    const appLogLinesShown = countLines(appLogText);
    const appLogLinesTotal = countLines(appLogTextRaw);

    // 整页重建前记住日志滚动位置：SSE/轮询触发的 quiet 重建会重置 DOM，
    // 不补偿的话用户往下翻日志会被弹回顶部（Kondius 实测：划两下就蹦上去）
    const oldPre = box.querySelector('#sl-logs-view');
    const prevScroll = oldPre
      ? { top: oldPre.scrollTop, atBottom: oldPre.scrollTop + oldPre.clientHeight >= oldPre.scrollHeight - 40 }
      : null;
    const oldAppPre = box.querySelector('#app-logs-view');
    const prevAppScroll = oldAppPre
      ? { top: oldAppPre.scrollTop, atBottom: oldAppPre.scrollTop + oldAppPre.clientHeight >= oldAppPre.scrollHeight - 40 }
      : null;

    // ⚠️ 临时诊断打点已移除（定位完成：见下方 logsSource 的说明）

    box.innerHTML = `
      <div class="snowluma-page-card">
        <h2>SnowLuma（OneBot 网关）</h2>

        <!-- 一键启动区域（核心入口） -->
        ${!onebotConnected ? `
        <div class="quick-start-section" style="background:var(--bg);border:none;border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:var(--raise-sm)">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">🚀 快速启动</div>
          <div class="muted" style="font-size:13px;margin-bottom:12px;line-height:1.6">
            ${!qqReady ? '便携 QQ 未安装，请先运行 <code>npm run setup</code>' :
              !qqRunning ? '点击下面按钮，自动完成：启动 QQ → 启动 SnowLuma → 连接 OneBot' :
              !running ? 'QQ 已运行，点击启动 SnowLuma 并连接' :
              'SnowLuma 已运行，等待 OneBot 连接…'}
          </div>
          <button class="btn btn-primary" id="quick-start-btn" style="font-size:14px;padding:10px 20px" ${!qqReady ? 'disabled' : ''}>
            ${!qqReady ? '请先运行 npm run setup' :
              !qqRunning ? '一键启动（QQ + SnowLuma）' :
              !running ? '启动 SnowLuma' :
              '等待连接…'}
          </button>
          <span id="quick-start-hint" class="muted" style="font-size:12px;margin-left:12px"></span>
        </div>` : ''}

        <!-- 便携 QQ 内核状态 -->
        <div class="snowluma-qq-section">
          <div class="snowluma-state-row">
            <span class="dot ${qqRunning ? 'dot-on' : 'dot-off'}"></span>
            <span>QQ 内核：<strong>${qqRunning ? `运行中${qqPid ? `（pid ${qqPid}）` : ''}` : (qqReady ? '未启动' : '未安装')}</strong></span>
            ${!qqReady ? '<span class="muted" style="color:var(--orange)">请先运行 npm run setup</span>' : ''}
          </div>
          ${qqReady ? `
          <div class="snowluma-state-row muted" style="font-size:12px">
            <span>目录：${esc(qq.dir || '')}</span>
          </div>` : ''}
          <div class="snowluma-actions">
            <button class="btn btn-small" id="qq-start-btn" ${!qqReady || qqRunning ? 'disabled' : ''}>${qqRunning ? '已运行' : '单独启动 QQ'}</button>
            <button class="btn btn-small btn-danger" id="qq-stop-btn" ${!qqRunning ? 'disabled' : ''}>关闭 QQ</button>
            <span id="qq-hint" class="muted" style="font-size:12px"></span>
          </div>
          ${qqLogText !== '暂无日志' ? `
          <div class="sl-log-block">
            <div class="hint sl-log-head">QQ 日志</div>
            <pre class="snowluma-logs-view" id="qq-logs-view" style="max-height:120px">${esc(qqLogText)}</pre>
          </div>` : ''}
        </div>

        <hr class="sl-sep">

        <!-- SnowLuma 状态 -->
        <div class="snowluma-qq-section">
          <div class="snowluma-state-row">
            <span class="dot ${running ? 'dot-on' : 'dot-off'}"></span>
            <span>SnowLuma：<strong>${running ? '运行中' : '未运行'}</strong></span>
            ${pid ? `<span class="muted">pid ${pid}</span>` : ''}
            <span class="muted">${embedded ? '内置模式（随 QQ Agent 退出）' : (running ? '独立模式' : '')}</span>
          </div>
          <div class="snowluma-state-row">
            <span class="dot ${onebotConnected ? 'dot-on' : 'dot-off'}"></span>
            <span>OneBot：<strong>${onebotConnected ? `已连接${s.onebot.self ? `（${s.onebot.self.nickname}）` : ''}` : '未连接'}</strong></span>
            <span class="muted">WS ${s.onebot?.error ? `：${s.onebot.error}` : ''}</span>
          </div>
          <div class="snowluma-state-row muted">
            <span>目录：${esc(dir || '（未找到项目内 snowluma/ 文件夹）')}</span>
          </div>
          <div class="snowluma-state-row">
            <span>WebUI：</span>
            ${webuiUrl
              ? `<button class="btn btn-small" id="sl-open-webui-btn" title="在浏览器中打开 SnowLuma 控制台">${esc(webuiUrl)}</button>`
              : '<span class="muted">等待 SnowLuma 启动后自动识别…</span>'}
          </div>
          <div class="snowluma-actions">
            <button class="btn btn-primary" id="sl-start-btn" ${running ? 'disabled' : ''}>${running ? '已运行' : '启动 SnowLuma'}</button>
            <button class="btn btn-danger" id="sl-stop-btn" ${running ? '' : 'disabled'}>关闭 SnowLuma</button>
            <button class="btn btn-small" id="sl-refresh-btn">刷新状态</button>
            <button class="btn btn-small" id="sl-open-folder-btn">打开文件夹</button>
            <span id="sl-hint" class="muted" style="font-size:12px"></span>
          </div>
        </div>
        <!-- 运行日志：可折叠。折叠态只渲染最近 5 行（见 slTrimLogTail 的说明） -->
        <div class="sl-log-block${slLogCollapsed('sl') ? ' sl-folded' : ''}" id="sl-log-block" data-log-which="sl">
          <div class="hint sl-log-head">
            <button class="sl-log-toggle" id="sl-log-toggle" type="button"
                    aria-expanded="${slLogCollapsed('sl') ? 'false' : 'true'}"
                    title="展开 / 折叠日志">
              <svg class="sl-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.6 6 7.6l3-3"/></svg>
            </button>
            <span>运行日志（仅保留最近 500 行）</span>
            ${logsSourceLabel ? `<span class="muted" style="font-weight:400">· ${esc(logsSourceLabel)}</span>` : ''}
            <span class="sl-log-count muted" id="sl-log-count" style="font-weight:400">${logLinesShown < logLinesTotal ? `${logLinesShown} / ${logLinesTotal} 行` : `${logLinesTotal} 行`}</span>
          </div>
          <pre class="snowluma-logs-view" id="sl-logs-view">${esc(logText)}</pre>
        </div>

        <!-- 应用日志：logger.js 的内存环形缓冲 + data/logs/ 落盘文件。同样可折叠 -->
        <div class="sl-log-block sl-app-logs${slLogCollapsed('app') ? ' sl-folded' : ''}" id="app-log-block" data-log-which="app">
          <div class="hint sl-log-head">
            <button class="sl-log-toggle" id="app-log-toggle" type="button"
                    aria-expanded="${slLogCollapsed('app') ? 'false' : 'true'}"
                    title="展开 / 折叠日志">
              <svg class="sl-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.6 6 7.6l3-3"/></svg>
            </button>
            <span>应用日志（最近 ${appLogs.length} 条，同时落盘到 data/logs/）</span>
            <label class="sl-log-level">
              <span class="muted">落盘级别</span>
              <select id="app-log-level" title="低于该级别的日志不写入磁盘">
                ${['debug', 'info', 'warn', 'error'].map((v) =>
                  `<option value="${v}" ${appLogLevel === v ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <button class="btn btn-small" id="app-logs-refresh-btn" title="重新拉取最近日志">刷新</button>
            <span class="sl-log-count muted" id="app-log-count" style="font-weight:400">${appLogLinesShown < appLogLinesTotal ? `${appLogLinesShown} / ${appLogLinesTotal} 行` : `${appLogLinesTotal} 行`}</span>
          </div>
          <pre class="snowluma-logs-view" id="app-logs-view">${esc(appLogText)}</pre>
        </div>
      </div>`;

    // 恢复日志滚动：贴底跟随新日志；否则回到原阅读位置；首次渲染贴底
    const newPre = box.querySelector('#sl-logs-view');
    if (newPre) newPre.scrollTop = prevScroll ? (prevScroll.atBottom ? newPre.scrollHeight : prevScroll.top) : newPre.scrollHeight;
    const newAppPre = box.querySelector('#app-logs-view');
    if (newAppPre) newAppPre.scrollTop = prevAppScroll ? (prevAppScroll.atBottom ? newAppPre.scrollHeight : prevAppScroll.top) : newAppPre.scrollHeight;

    // ── 日志区折叠开关（2026-10-05 加）────────────────────────────────────
    // 折叠/展开都走**整页重建**（loadSnowlumaPage）：折叠态要"只显示最近 5 行"，
    // 那是"渲染多少行"的差别，靠切 CSS 类做不到（除非限高，而限高会让日志
    // 看起来卡住/丢失）。重建一次顺便把"显示 N / 共 M 行"的计数也更新掉。
    [['sl-log-toggle', 'sl'], ['app-log-toggle', 'app']].forEach(([btnId, which]) => {
      const b = document.getElementById(btnId);
      if (!b) return;
      b.addEventListener('click', () => {
        setSlLogCollapsed(which, !slLogCollapsed(which));
        loadSnowlumaPage({ quiet: true });
      });
    });

    // ── 应用日志：级别切换 + 手动刷新 ──
    if (typeof enhanceConcept2UI === 'function') enhanceConcept2UI(box);
    const appLevelSel = $('#app-log-level');
    if (appLevelSel) {
      appLevelSel.addEventListener('change', async () => {
        try {
          const r = await api('/api/logs/level', { method: 'POST', body: JSON.stringify({ level: appLevelSel.value }) });
          if (r && r.level) appLevelSel.value = r.level;
          loadSnowlumaPage({ quiet: true });
        } catch (e) {
          alert(`设置日志级别失败：${e.message}`);
        }
      });
    }
    const appLogsRefreshBtn = $('#app-logs-refresh-btn');
    if (appLogsRefreshBtn) appLogsRefreshBtn.addEventListener('click', () => loadSnowlumaPage());

    // ── 一键启动按钮事件 ──
    const quickStartBtn = $('#quick-start-btn');
    if (quickStartBtn) quickStartBtn.addEventListener('click', async () => {
      const btn = $('#quick-start-btn');
      const hint = $('#quick-start-hint');
      btn.disabled = true;
      hint.textContent = '';

      try {
        // 步骤 1：启动便携 QQ（如果未运行）
        if (!qqRunning) {
          btn.textContent = '启动 QQ 中…';
          hint.textContent = '请在弹出的 QQ 窗口扫码登录';
          const r = await api('/api/qq-portable/launch', { method: 'POST', body: '{}' });
          if (!r.ok && !r.alreadyRunning) {
            hint.textContent = `QQ 启动失败：${r.error}`;
            btn.disabled = false;
            btn.textContent = '一键启动（QQ + SnowLuma）';
            return;
          }
          // 等 3 秒让 QQ 完全启动
          await new Promise((r) => setTimeout(r, 3000));
        }

        // 步骤 2：启动 SnowLuma（如果未运行）
        if (!running) {
          btn.textContent = '启动 SnowLuma 中…';
          hint.textContent = '正在启动协议端…';
          const r = await api('/api/snowluma/launch', { method: 'POST', body: '{}' });
          if (!r.ok && !r.alreadyRunning) {
            hint.textContent = `SnowLuma 启动失败：${r.error}`;
            btn.disabled = false;
            btn.textContent = '一键启动（QQ + SnowLuma）';
            return;
          }
        }

        // 步骤 3：等待 OneBot 连接
        btn.textContent = '等待 OneBot 连接…';
        hint.textContent = '首次登录可能需要几秒到几十秒';

        // 轮询检查连接状态（最多 30 秒）
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const s = await api('/api/status');
          if (s.onebot?.connected) {
            hint.textContent = '✅ 已连接！机器人开始工作';
            btn.textContent = '已连接 ✓';
            setTimeout(() => loadSnowlumaPage({ quiet: true }), 1500);
            return;
          }
        }
        hint.textContent = '连接超时，请检查日志或手动刷新';
        btn.disabled = false;
        btn.textContent = '重试';
      } catch (e) {
        hint.textContent = `启动失败：${e.message}`;
        btn.disabled = false;
        btn.textContent = '一键启动（QQ + SnowLuma）';
      }
    });

    // ── 便携 QQ 按钮事件 ──
    const qqStartBtn = $('#qq-start-btn');
    if (qqStartBtn) qqStartBtn.addEventListener('click', async () => {
      const btn = $('#qq-start-btn');
      btn.disabled = true; btn.textContent = '启动中…';
      $('#qq-hint').textContent = '';
      try {
        const r = await api('/api/qq-portable/launch', { method: 'POST', body: '{}' });
        $('#qq-hint').textContent = r.alreadyRunning ? '便携 QQ 已在运行 ✓' : (r.ok ? '已启动，请在弹出的 QQ 窗口扫码登录' : `启动失败：${r.error}`);
      } catch (e) {
        $('#qq-hint').textContent = `启动失败：${e.message}`;
      }
      setTimeout(() => loadSnowlumaPage({ quiet: true }), 2500);
    });
    const qqStopBtn = $('#qq-stop-btn');
    if (qqStopBtn) qqStopBtn.addEventListener('click', async () => {
      const btn = $('#qq-stop-btn');
      btn.disabled = true; btn.textContent = '关闭中…';
      $('#qq-hint').textContent = '';
      try {
        const r = await api('/api/qq-portable/stop', { method: 'POST', body: '{}' });
        $('#qq-hint').textContent = r.ok ? '已请求关闭便携 QQ' : `关闭失败：${r.error}`;
      } catch (e) {
        $('#qq-hint').textContent = `关闭失败：${e.message}`;
      }
      setTimeout(() => loadSnowlumaPage({ quiet: true }), 1500);
    });

    $('#sl-start-btn').addEventListener('click', async () => {
      const btn = $('#sl-start-btn');
      btn.disabled = true; btn.textContent = '启动中…';
      $('#sl-hint').textContent = '';
      try {
        const r = await api('/api/snowluma/launch', { method: 'POST', body: '{}' });
        $('#sl-hint').textContent = r.alreadyRunning ? 'SnowLuma 已经在运行 ✓' : (r.ok ? '已启动，日志见下方。首次 QQ 登录需要几秒到几十秒。' : `启动失败：${r.error}`);
      } catch (e) {
        $('#sl-hint').textContent = `启动失败：${e.message}`;
      }
      setTimeout(() => loadSnowlumaPage({ quiet: true }), 2500);
    });
    $('#sl-stop-btn').addEventListener('click', async () => {
      const btn = $('#sl-stop-btn');
      btn.disabled = true; btn.textContent = '关闭中…';
      $('#sl-hint').textContent = '';
      try {
        await api('/api/snowluma/stop', { method: 'POST', body: '{}' });
        $('#sl-hint').textContent = '已请求关闭 SnowLuma。';
      } catch (e) {
        $('#sl-hint').textContent = `关闭失败：${e.message}`;
      }
      setTimeout(() => loadSnowlumaPage({ quiet: true }), 1500);
    });
    $('#sl-refresh-btn').addEventListener('click', () => loadSnowlumaPage());
    $('#sl-open-folder-btn').addEventListener('click', async () => {
      try { await api('/api/snowluma/open-folder', { method: 'POST', body: '{}' }); }
      catch (e) { $('#sl-hint').textContent = `失败：${e.message}`; }
    });
    const webuiBtn = $('#sl-open-webui-btn');
    if (webuiBtn) webuiBtn.addEventListener('click', async () => {
      try {
        const r = await api('/api/snowluma/open-webui', { method: 'POST', body: '{}' });
        if (!r.ok) $('#sl-hint').textContent = r.error;
      } catch (e) {
        $('#sl-hint').textContent = `打开失败：${e.message}`;
      }
    });
  } catch (e) {
    // ⚠️ 失败必须**可见**（2026-10-04 改）。原来是 `if (!quiet) console.error(e)`：
    //    quiet 重建（SSE 触发）时连控制台都没有，而页面又停在空白 ——
    //    用户看到"打不开"，开发者看到"没有错误"，两边都无从下手。
    //    现在：非 quiet 时在页面上给出可操作的提示；quiet 时至少记 console。
    if (!quiet) {
      const box = $('#snowluma-page');
      if (box && !box.innerHTML.trim()) {
        box.innerHTML = `<div class="snowluma-page-card">
          <h2>SnowLuma（OneBot 网关）</h2>
          <p class="muted">页面加载失败：${esc(String((e && e.message) || e))}</p>
          <button class="btn btn-small" id="sl-retry-load-btn">重试</button>
        </div>`;
        const rb = $('#sl-retry-load-btn');
        if (rb) rb.addEventListener('click', () => loadSnowlumaPage());
      } else if (box) {
        const hint = $('#sl-hint');
        if (hint) hint.textContent = `刷新失败：${String((e && e.message) || e)}`;
      }
    }
    console.error(e);
  }
}
