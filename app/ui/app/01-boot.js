// 〔启动 loading 壳 / 就绪体检 / 状态栏〕——M9 拆分第 2 段
'use strict';
// ── 状态栏 ──
async function refreshStatus() {
  try {
    state.status = await api('/api/status');
    const s = state.status;
    const dot = $('#onebot-dot');
    const label = $('#onebot-label');
    dot.className = 'dot ' + (s.onebot.connected ? 'dot-on' : (s.onebot.everConnected ? 'dot-wait' : 'dot-off'));
    // 未连接时展示后端诊断（2026-09-19）：区分「SnowLuma 没起 / 没登录账号 / 令牌不匹配」，
    // 不再让用户面对一句干巴巴的"未连接"猜原因。
    label.textContent = s.onebot.connected
      ? `OneBot 已连接${s.onebot.self ? `（${s.onebot.self.nickname}）` : ''}`
      : (s.onebot.diagnosis || 'OneBot 未连接');
    label.title = s.onebot.connected ? '' : (s.onebot.error || '');
    // 顶栏这个标签现在是**入口**（点它跳到「设置 → 人设」）：文字固定为「人设/模型设置」，
    // 当前主模型放进 title —— 每次刷新都会走到这里，往 textContent 写模型名会把入口文字覆盖掉。
    const modelLabel = $('#model-label');
    if (modelLabel) {
      modelLabel.textContent = '人设/模型设置';
      modelLabel.title = `当前主模型：${s.orchestrator.model || '未设置'}\n点击进入「设置 → 人设」（每个会话用哪个模型也在这里配）`;
      modelLabel.dataset.model = s.orchestrator.model || '';
    }
    const u = s.usage;
    // 成本：官方价匹配得上就显示；匹配不上（中转站常见）只显示 token，不显示误导性的 ¥0
    const c = s.cost;
    const costTxt = c && c.cost > 0 ? ` · ¥${c.cost.toFixed(3)}` : '';
    const rate = s.cacheHitRate;
    const rateTxt = rate > 0 ? ` · 缓存 ${Math.round(rate * 100)}%` : '';
    $('#usage-label').textContent = `今日：${u.runs} 次运行 · ${fmtTokens(u.totalTokens)}${rateTxt}${costTxt}`;
    $('#search-count-label').textContent = `搜索：${s.webSearchCount ?? u.webSearchCount ?? 0} 次`;
    state.paused = s.paused;
    state.pauseReason = s.pauseReason;
    state.dataDir = s.dataDir || '';
    $('#pause-btn').textContent = state.paused ? '恢复' : '暂停';
    renderBanner();
    updateReadinessDots(s);
  } catch (e) { /* 忽略瞬时错误 */ }
}

/** 更新顶栏就绪进度指示器（4 圆点） */
function updateReadinessDots(s) {
  const dots = $$('#readiness-dots .rdot');
  if (dots.length !== 4) return;

  const qq = s?.qqPortable || {};
  const qqRunning = !!qq.running;
  const slRunning = !!s?.snowluma?.running;
  const obConnected = !!s?.onebot?.connected;
  const cfg = state.config || {};
  const cfgReady = !!(cfg.api?.baseUrl && cfg.api?.model && (cfg.allow?.groups?.length || cfg.allow?.private?.length || cfg.allowAllWhenEmpty));

  // 圆点 0：QQ 内核
  dots[0].className = 'rdot' + (qqRunning ? ' on' : '');
  dots[0].title = qqRunning ? 'QQ 内核运行中' : 'QQ 内核未运行（点击前往启动）';

  // 圆点 1：SnowLuma
  dots[1].className = 'rdot' + (slRunning ? ' on' : '');
  dots[1].title = slRunning ? 'SnowLuma 运行中' : 'SnowLuma 未运行（点击前往启动）';

  // 圆点 2：OneBot
  dots[2].className = 'rdot' + (obConnected ? ' on' : (slRunning ? ' wait' : ''));
  dots[2].title = obConnected ? 'OneBot 已连接' : (s?.onebot?.diagnosis || (slRunning ? 'OneBot 连接中…' : 'OneBot 未连接'));

  // 圆点 3：配置完成
  dots[3].className = 'rdot' + (cfgReady ? ' on' : '');
  dots[3].title = cfgReady ? '配置已完成' : '配置未完成（点击前往设置）';
}

// 就绪圆点点击跳转
$$('#readiness-dots .rdot').forEach((dot) => {
  dot.addEventListener('click', () => {
    const target = dot.dataset.target;
    // SnowLuma 面板已整合进「设置 → OneBot（SnowLuma）」：
    // 就绪圆点原来切到独立页签，现在直接打开那个设置区块。
    if (target === 'snowluma') {
      if (typeof openSettingsSection === 'function') openSettingsSection('onebot');
      else switchTab('settings');
    }
    else if (target === 'settings') switchTab('settings');
  });
});

function fmtTokens(n) {
  n = Number(n) || 0;
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}

$('#pause-btn').addEventListener('click', async () => {
  if (state.paused) {
    await resumePause({ skipBacklog: false });
  } else {
    await api('/api/pause', { method: 'POST', body: JSON.stringify({ paused: true }) });
    refreshStatus();
  }
});

// ── 会话渲染合批 ──
// 运行中的会话 SSE 事件非常密：每轮"正在思考…"开/关两次 + 每个工具调用一次。
// 曾经来一条事件就全量重建一次会话列表 + 会话详情（含大提示词的 esc/innerHTML），
// 主线程被反复长阻塞，详情内容反而"更新缓慢"、还伴随滚动跳动。
// 现在：patch 立即进 state（数据不延迟），渲染合并到短定时器一次；
// 窗口内的多次事件只渲染最终状态（中间的 activity 翻转根本不必上屏）。
//
// ⚠️ 用 setTimeout 而不是 requestAnimationFrame：
//    窗口被遮挡/最小化时 Chromium 会完全停发 rAF，渲染全部积压到切回前台
//    才一次性出现 —— 用户看到的就是"不手动刷新就不更新"。
//    setTimeout 在后台页面仍会执行（最多被节流到 1s），远比不执行强。
const pendingSessionDetail = new Map();   // sessionId -> 合并后的 patch
let sessionRenderScheduled = false;

function scheduleSessionRender() {
  if (sessionRenderScheduled) return;
  sessionRenderScheduled = true;
  setTimeout(() => {
    sessionRenderScheduled = false;
    if (state.tab === 'sessions') renderSessionList();
    const id = state.currentSessionId;
    const patch = id ? pendingSessionDetail.get(id) : null;
    pendingSessionDetail.clear();
    if (patch && state.tab === 'sessions') {
      // 详情用事件里的消息流渲染：HTTP 详情（systemPrompt 等）打底，SSE patch 覆盖动态字段。
      // sent/finishReason 等收尾字段 patch 优先 —— 它们走 SSE 实时推，HTTP 详情里的是旧值。
      renderSessionDetail({
        ...(state.sessionDetail || {}),
        ...patch,
        triggerSummary: patch.triggerSummary ?? state.sessionDetail?.triggerSummary ?? '',
        systemPrompt: state.sessionDetail?.systemPrompt ?? '',
        userPrompt: state.sessionDetail?.userPrompt ?? '',
        sent: patch.sent ?? state.sessionDetail?.sent ?? [],
        error: patch.error !== undefined ? patch.error : (state.sessionDetail?.error ?? null),
        finishReason: patch.finishReason ?? state.sessionDetail?.finishReason ?? null,
        endedAt: patch.endedAt ?? state.sessionDetail?.endedAt ?? null
      });
    }
  }, 80);
}

/**
 * 顶栏账号切换（多账号）
 *
 * 设计：注册表里的 active 账号 = "当前查看/编辑的账号"。后端配置类接口默认就跟随它
 * （config.js 的 configFileFor 回落 active），所以这边只需要：填充下拉 → 切换时把
 * active 改掉 → 重载控制台（重载最稳，保证没有任何页面残留着上一个号的状态）。
 */
async function loadAccountSwitcher() {
  const sel = document.getElementById('account-switch');
  if (!sel) return;

  // 只更新选项文字与选中项，**不重建整个 select 的选择状态**
  // （否则用户正在挑账号时被刷新打断 ✗）。
  function renderOptions(list, active) {
    const keep = sel.value;
    sel.innerHTML = list.map((a) => {
      const rt = a.runtime || {};
      const state = rt.connected === true ? '在线' : (rt.running ? '离线' : '未接入');
      return `<option value="${a.uin}">${a.label || a.uin} · ${state}</option>`;
    }).join('');
    const want = String(active || '') || keep || (list[0]?.uin ?? '');
    if (want && list.some((a) => a.uin === want)) sel.value = want;
    // 悬停提示里带上全局暂停状态（切号界面也能一眼看到）
    const paused = (typeof state !== 'undefined' && state.status && state.status.paused) ? '⏸ 已暂停' : '▶ 运行中';
    sel.title = `机器人 ${paused}（全局） · 切换账号：` + list.map((a) => `${a.label || a.uin}(${a.uin})`).join(' · ');
  }

  async function refresh() {
    // 用户正拉开下拉选择时不刷新（避免打断）
    if (document.activeElement === sel) return;
    try {
      const data = await api('/api/accounts');
      const list = Array.isArray(data?.accounts) ? data.accounts : [];
      // 供设置页「进阶」同步渲染账号联动表（避免那边再发一次请求、出现"读取中"）
      if (typeof state !== 'undefined') state.accounts = list;
      renderOptions(list, data?.active);
    } catch {
      if (!sel.options.length) sel.innerHTML = '<option>账号列表读取失败</option>';
    }
  }

  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.onchange = async () => {
      const uin = sel.value;
      sel.disabled = true;
      try {
        await api('/api/accounts', { method: 'POST', body: JSON.stringify({ action: 'setActive', uin }) });
        location.reload();          // 重载最稳：不留上一个账号的任何残留状态
      } catch (e) {
        alert('切换账号失败：' + e.message);
        sel.disabled = false;
      }
    };
  }

  await refresh();
  // ⚠️ 关键修复（2026-10-03 用户反馈"下拉里 bot 号一直显示离线，账号页却是在线"）：
  //    后端状态快照每 8 秒刷新一次，但下拉以前只在页面加载时取一次 → 那一刻若正在重连，
  //    就会一直显示"离线"。改成每 10 秒跟着刷新。
  if (!sel.dataset.timer) sel.dataset.timer = String(setInterval(() => { void refresh(); }, 10000));
}
loadAccountSwitcher();
