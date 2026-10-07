// 〔设置渲染 / 模型目录 / 技能插件页〕——M9 拆分第 7 段
'use strict';
// ── 模型目录（多提供商；面板式选择 + 图片输入能力徽标） ──
function visionBadge(providerId, model) {
  const r = (state.visionResults || {})[`${providerId}|||${model}`];
  const src = r?.source === 'docs' ? '官方资料' : (r?.source === 'probe' ? '在线探测' : '');
  const show = state.config?.ui?.showVision !== false;
  const t = (cls, text) => `<span class="vbadge ${cls}" style="${show ? '' : 'display:none'}" title="${esc((src ? `【${src}】` : '') + (r?.note || ''))}">${text}</span>`;
  if (!r) return t('unk', '未检测');
  if (r.verdict === 'vision') return t('ok', '支持图片输入');
  if (r.verdict === 'no-vision') return t('no', '不支持图片输入');
  return t('unk', '无法判定');
}

/** 左右开关（.switch）：设置页统一勾选形态。 */
function switchHtml(id, checked, label, extra = '') {
  return `<label class="switch"${extra ? ` ${extra}` : ''}>
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
    <span class="track"><span class="thumb"></span></span>
    <span>${label}</span>
  </label>`;
}

// ── 两栏悬停下拉：左供应商 / 右模型 ──
function visionVerdictOf(providerId, model) {
  return (state.visionResults || {})[`${providerId}|||${model}`]?.verdict;
}

// 说明：这里曾经有一个 bindModelDdDismiss()，目标是 #model-dd / #model-pick-btn，
// 但真正的模型选择控件 id 是 #cfg-model-pick / #cfg-model（记忆页是 #cfg-mem-model-pick），
// 那两个 id 全项目从未被创建过 —— 函数也从未被调用，属于纯死代码，已删除。
// 若将来需要一个"点击外部/Esc 收起目录"的通用行为，请在 modelModalShell 里统一实现。




function renderSettingsSidebar() {
  const s = state.status;
  const sidebar = $('#settings-sidebar');
  if (!sidebar) return;
  const menu = [
    ['api', '模型 API'],
    ['search', '搜索服务'],
    ['memory', '记忆'],
    ['allow', '聊天白名单'],
    ['chat', '聊天设置'],
    ['desktop', '桌面端'],
    // 个性化：配色 + 动效开关。放在「桌面端」之后（都属于"界面观感"这一类），
    // 排在 OneBot/进阶/工具这些"功能设置"之前，避免混在功能项里不好找。
    ['personal', '个性化'],
    // 主题：与「个性化」并列的独立卡页（用户要求"个性化中单独加一个卡页：主题"）。
    // 为什么不并进「个性化」里：个性化管的是**逐项颜色变量**（几十行色块 + 三种格式），
    // 而主题管的是**整套配色体系 + 图标 + 字体 + 背景 + 音效**。
    // 两者体量与受众都不同，混在一页会让"我只想换个主题"变成在一长串色号里找入口。
    ['theme', '主题'],
    ['onebot', 'OneBot（SnowLuma）'],
    ['advanced', '进阶'],
    ['tools', '工具与技能']
  ];
  sidebar.innerHTML = `
    <div class="settings-runstate">
      <div class="rs-title">机器人运行状态</div>
      <div class="rs-row"><span class="dot ${s?.onebot?.connected ? 'dot-on' : 'dot-off'}"></span><span>${s?.onebot?.connected ? '运行中' : '未就绪'}</span></div>
      <div class="rs-row muted">${state.paused ? '⏸ 已暂停' : (s?.orchestrator?.model ? `模型：${esc(s.orchestrator.model)}` : '模型：未设置')}</div>
    </div>
    <div class="settings-menu">
      ${menu.map(([id, label]) => `<button class="settings-menu-item ${state.settingsSection === id ? 'active' : ''}" data-section="${id}">${label}${id === 'desktop' && (typeof updateAvailable !== 'undefined' && updateAvailable) ? '<span class="update-dot" title="发现新版本"></span>' : ''}</button>`).join('')}
      <button class="settings-menu-item egg-hot" id="qrcode-egg-btn">！？群群？！</button>
    </div>`;
  // 群二维码彩蛋：点一下弹出，再点屏幕任意位置关闭
  // 图片 onerror 兜底：group-qrcode.jpg 正常随 ui/ 分发，
  // 万一分发包缺了这张图，显示一句说明而不是一个裂图图标。
  sidebar.querySelector('#qrcode-egg-btn')?.addEventListener('click', () => {
    const ov = document.createElement('div');
    ov.className = 'qrcode-egg-overlay';
    ov.innerHTML = '<img src="group-qrcode.jpg" alt="群二维码" '
      + 'onerror="this.remove(); this.parentElement?.insertAdjacentText(\'afterbegin\', \'二维码图片缺失：请把 group-qrcode.jpg 放到 ui/ 目录下\')" />';
    const close = () => closeAnimatedOverlay(ov);
    ov.addEventListener('click', close);
    document.body.appendChild(ov);
  });
  sidebar.querySelectorAll('.settings-menu-item').forEach((el) => {
    el.addEventListener('click', () => {
      // 切区块 = 整页表单重建：先把防抖窗口内挂起的保存发出，
      // 否则刚输入的内容直接被重渲染吹掉（与切页签同一条防线）。
      flushSettingsSaves();
      state.settingsSection = el.dataset.section;
      renderSettingsSidebar();
      renderSettings();
      // 切设置分区 = 整页表单重建：新内容淡入（对齐 concept2 的 pane 切换）
      uiEnter($('#settings-form'));
    });
  });
}

/**
 * 跳到设置页的某个区块（顶栏入口与左侧菜单共用同一条路径）。
 * @param {string} section 区块 id：api / persona / accounts / …
 */
function openSettingsSection(section) {
  if (section === 'persona') { switchTab('persona'); return; }
  try {
    if (typeof flushSettingsSaves === 'function') flushSettingsSaves();
    switchTab('settings');
    state.settingsSection = section || 'api';
    renderSettingsSidebar();
    renderSettings();
    uiEnter($('#settings-form'));
    document.querySelector('.settings-menu-item.active')?.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    console.error(`跳转到设置区块 ${section} 失败：`, error);
  }
}

/**
 * 跳到「设置 → 人设」页。（顶栏「人设/模型设置」标签用）
 */
function openPersonaSettings() {
  switchTab('persona');
}

/**
 * 「账号」页签：多账号 = 多实例（2026-10-03 从设置页搬到顶栏页签，位置在 SnowLuma 右侧）。
 *
 * 一个 QQ 号跑一个实例，实例之间的数据目录/端口/设置完全隔离 ——
 * 所以"分账号独立设置所有功能"不需要额外做配置隔离，框架的 profile 机制已经做到了。
 * 这里只渲染列表外壳；真正的列表内容与按钮接线在 07 的 bindAccountsPanel()。
 */
function loadAccountsPage() {
  const view = document.getElementById('view-accounts');
  if (!view) return;
  view.innerHTML = `
    <div class="acc-page">
      <h3 style="margin-top:0">账号（多开 · 分账号）</h3>
      <div class="hint" style="margin-bottom:10px" id="cfg-pause-state">机器人状态：<b>${(typeof state !== 'undefined' && state.status && state.status.paused) ? '⏸ 已暂停（不会回复任何消息）' : '▶ 运行中'}</b><span class="muted">（全局开关，用顶栏「暂停/继续」切换）</span></div>
      <div class="hint" style="margin-bottom:12px">
        一个 QQA 进程同时带多个 QQ 号：<b>每个号一套独立配置与数据</b>
        （人设 / 模型 / 白名单 / 记忆 / 会话 / 用量各自一份，存在 <code>data/accounts/&lt;QQ号&gt;/</code>）。<br>
        「当前账号」= 你在设置页正在查看/编辑的那个号，用顶栏下拉或下面的「设为当前」切换。
      </div>
      <div class="panel" style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px 16px">
        <div style="font-weight:600;margin-bottom:2px">账号列表</div>
        <div class="hint" style="margin-bottom:10px">设为当前 / 改名 / 删除 · 连接与数据概况</div>
        <div id="accounts-box"><div class="hint">加载中…</div></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="accounts-add-btn">＋ 添加账号</button>
          <!-- ⚠️ 这里原来是 btn + btn-small，比左边的「添加账号」矮一截、
               两个按钮不等高（用户截图指出）。改成同一个 btn 类，尺寸完全一致。 -->
          <button class="btn" id="accounts-refresh-btn">刷新状态</button>
        </div>
      </div>
      <div class="hint" style="margin-top:12px">
        · 新号要先在 <b>SnowLuma</b>（<code>http://127.0.0.1:5099</code>）里登录，并让它用**自己的** OneBot 端口
        （bot 号 3000/3001、第二个号 3100/3101、依次 +100）。<br>
        · 号连上后在本页「设为当前」→ 再去 设置 →「人设」「模型 API」「聊天白名单」配它自己的东西。<br>
        · 白名单为空的号不会在任何会话里发言（默认就是安全的，不会替号主人乱说话）。
      </div>
    </div>`;
  bindAccountsPanel();
}

function renderSettings() {
  // 渲染守卫：自动保存进行中（表单正在被读取 / state.config 即将被覆盖）时
  // 不允许重建表单 DOM —— 会吹掉用户正在输入的未保存内容。
  // 拦下的请求由 endSettingsGuard() 在保存完成后补放。
  if (settingsGuard.pending > 0) {
    settingsGuard.needRerender = true;
    return;
  }
  // 焦点保护（2026-09-19 修"文本框偶发点不进/失焦"）：守卫只护住"保存进行中"的
  // 窗口，但守卫之外仍有一批异步重渲染（群名补底 / 视觉扫描完成 / 技能开关保存 /
  // 守卫补放的延迟渲染）会在用户打字途中重建 innerHTML —— 焦点、光标位置、
  // 未落盘的输入值全部被吹掉。这里在重建前后做"焦点与选区快照恢复"：
  //   ① 记下正在聚焦的输入框 id + 光标位置 + 当前值；
  //   ② 重建后按 id 找回元素，把值写回（渲染用的是 state.config，可能还没
  //      带上防抖窗口内的输入），恢复焦点与光标。
  const box = $('#settings-form');
  // 滚动位置保持：innerHTML 重建会把阅读位置弹回顶部（也是一次大滚动跳转，
  // 会加剧深滚动下的合成错位）。重建后原样恢复。
  const prevScrollTop = box ? box.scrollTop : 0;
  const focusSnap = (() => {
    const el = document.activeElement;
    if (!box || !el || el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return null;
    if (el.type === 'checkbox' || el.type === 'radio' || !box.contains(el)) return null;
    return {
      id: el.id,
      selStart: el.selectionStart ?? null,
      selEnd: el.selectionEnd ?? null,
      value: el.value
    };
  })();
  const c = state.config;
  renderSettingsSidebar();
  /**
   * ⚠️ 配置还没到位时**不要硬渲染**，也不要把异常甩给用户。
   *
   * 背景（一次真实的"设置页全空白"故障）：
   *   `state.config` 是 `loadSettings()` 里 `Promise.all([...7 个请求])` 全部完成
   *   之后才赋值的。任何一个请求慢/失败（冷启动时后端要枚举进程、查外网），
   *   或者 `init()` 在 `bootLoop()` 那步就 return 了（服务还没起来时点设置），
   *   `state.config` 就会一直是 null。
   *   而设置页里 `renderApiSection` / `renderToolsSection` 是**直接解引用** `c.api.value`
   *   / `c.tools` 的（没有 `?.`），于是抛出
   *     TypeError: Cannot read properties of null (reading 'api')
   *   被下面 catch 成"设置页渲染失败：…"——整块内容变成一行红字，
   *   用户只能刷新，而刷新后往往还是同样结果（因为诱因是启动竞态）。
   *
   * 现在改成：缺配置就渲染一个**加载态**并自动重试，等配置到了再正常渲染。
   * 这样最坏情况是"多转一会儿"，而不是"一片报错"。
   */
  if (!c || typeof c !== 'object') {
    box.innerHTML = `
      <div class="setcard"><div class="setcard-head"><div class="sc-ico">⏳</div>
        <div class="sc-tt"><h4>正在加载设置…</h4>
          <div class="sc-sub">配置还没取回来（首次启动或后端较慢时会出现）。正在自动重试。</div></div>
      </div></div>`;
    // 有界自愈：最多重试 10 次 × 700ms。成功一次之后就不再排了。
    if (!box.__qqaCfgRetry) box.__qqaCfgRetry = 0;
    if (box.__qqaCfgRetry < 10) {
      box.__qqaCfgRetry += 1;
      setTimeout(() => {
        if (state.config) { box.__qqaCfgRetry = 0; renderSettings(); return; }
        if (typeof loadSettings === 'function') {
          Promise.resolve(loadSettings()).then(() => {
            if (state.config) { box.__qqaCfgRetry = 0; renderSettings(); }
            else renderSettings();
          }).catch(() => renderSettings());
        } else {
          renderSettings();
        }
      }, 700);
    }
    return;
  }
  box.__qqaCfgRetry = 0;
  try {
    box.innerHTML = `
    ${renderSettingsSection(c)}`;
    // 先折叠收纳再绑事件：autoFold 会搬 DOM，但节点上的监听会跟着节点走；
    // 挂在 #settings-form 上的委托不受影响。放后面绑定则能找到最终结构。
    if (typeof enhanceConcept2UI === 'function') enhanceConcept2UI(box);
    bindSettingsEvents(c);
    if (state.tab === 'persona') void loadPersonaContacts();
    // 「主题」卡页的接线（皮肤卡 / 亮度档 / Minecraft 二级设置）。
    // 放这里而不是 renderThemeSection 里：渲染与接线分开是本项目的既有约定，
    // 重渲染时不会重复绑（DOM 已整块换掉，旧监听随之消失）。
    // 用 typeof 判断是为了让本文件在缺少该模块时（例如单独打开测试页）不报错。
    if (typeof bindThemeSectionEvents === 'function') bindThemeSectionEvents();
    if (box && prevScrollTop) box.scrollTop = prevScrollTop;
    // SnowLuma 面板：整合进「OneBot（SnowLuma）」区块后，需要在这里主动加载一次
    // （以前是靠 switchTab('snowluma') 触发；现在只有设置页内部切换区块）。
    // 必须放在 innerHTML 之后：容器要先存在，loadSnowlumaPage 才找得到。
    if (state.tab === 'settings' && (state.settingsSection || 'api') === 'onebot' && typeof loadSnowlumaPage === 'function') {
      loadSnowlumaPage({ quiet: true });
    }
  } catch (err) {
    // 单个设置区渲染失败不能让整页空白 —— 显示错误占位，其余页签仍可用
    console.error('[settings] 渲染失败:', err);
    box.innerHTML = `<div class="empty-hint">设置页渲染失败：${esc(err?.message || err)}<br />可切换其它页签，或刷新后重试。</div>`;
    return;
  }
  if (focusSnap?.id) {
    const back = box.querySelector('#' + focusSnap.id);
    if (back && (back.tagName === 'INPUT' || back.tagName === 'TEXTAREA')) {
      try {
        back.value = focusSnap.value;   // 覆盖渲染值：防抖窗口内的输入不被回滚
        if (focusSnap.selStart != null) back.setSelectionRange(focusSnap.selStart, focusSnap.selEnd ?? focusSnap.selStart);
        back.focus({ preventScroll: true });
      } catch { /* 恢复失败不致命 */ }
    }
  }
  // 群名补底（一次性）：分群按钮/活跃设置下拉第一次渲染时 state.chats 可能还没到
  // （switchTab 只在列表为空时才拉）。这里发现为空就补拉，到达后重渲染一次。
  if (!(state.chats || []).length && !renderSettings.__chatsFetch) {
    renderSettings.__chatsFetch = true;
    api('/api/chats').then((d) => {
      if ((d.chats || []).length && ['settings', 'persona'].includes(state.tab)) renderSettings();
    }).catch(() => {}).finally(() => { renderSettings.__chatsFetch = false; });
  }
  // ── SnowLuma 面板自愈（2026-10-04）────────────────────────────────────
  // 为什么要自愈、而不是只"渲染后加载一次"：
  //   打开「设置 → OneBot」会**连续触发多次** renderSettings
  //   （openSettingsSection 一次，随后的 loadSettings / 自动保存 / SSE 状态事件再来）。
  //   每一次都会把 #settings-form 整个换掉 —— 包括里面的 #snowluma-page 容器。
  //   于是在"加载中"的窗口期里，面板内容会随容器的更替被清掉：
  //     · 早先那次加载因"只认最后一次"的守卫被作废；
  //     · 最后一次渲染虽然发起了新加载，但它的容器也可能被再下一次渲染换掉
  //       （旧容器变成游离节点，写进去用户也看不见）。
  //   实测症状：OneBot 区块在、面板空白；表单只有 2054 字节（就是"标题 + 空容器"）。
  //
  // 所以这里做**有限次数的重试**（最多 5 次、每次间隔 700ms）：
  // 只要当前还在 onebot 区块且面板仍空着，就再加载一次。
  // 正常情况下面板 300ms 内就渲染完，第一次检查就会看到内容并立即停止，
  // 不会产生多余请求；只有在真的出现上述竞态时才补几次。
  if (state.tab === 'settings' && (state.settingsSection || 'api') === 'onebot' && typeof loadSnowlumaPage === 'function') {
    let tries = 0;
    const heal = () => {
      tries += 1;
      if (state.tab !== 'settings') return;
      if ((state.settingsSection || 'api') !== 'onebot') return;
      const host = document.getElementById('snowluma-page');
      if (!host) return;
      if (host.innerHTML.trim().length > 1000) return;   // 已经渲染好了
      if (tries > 5) return;                             // 放弃：别无限重试
      loadSnowlumaPage({ quiet: true });
      setTimeout(heal, 700);
    };
    setTimeout(heal, 700);
  }
}

function renderSettingsSection(c) {
  const sec = state.tab === 'persona' ? 'persona' : (state.settingsSection === 'persona' ? 'api' : state.settingsSection || 'api');
  const sections = {
    api: () => renderApiSection(c),
    search: () => renderSearchSection(c),
    memory: () => renderMemorySettingsSection(c),
    persona: () => renderPersonaSection(c),
    allow: () => renderAllowSection(c),
    chat: () => renderChatSection(c),
    desktop: () => renderDesktopSection(c),
    personal: () => renderPersonalizeSection(c),   // 个性化（新增）
    theme: () => renderThemeSection(c),            // 主题（皮肤 + 二级设置）
    onebot: () => renderOnebotSection(c),
    advanced: () => renderAdvancedSection(c),
    tools: () => renderToolsSection(c)
  };
  const render = sections[sec] || sections.api;
  return `
    ${render()}`;
}
function renderApiSection(c) {
  const currentProvider = (state.providers || []).find((p) => p.id === c.api.provider);
  const currentModelDisplay = (currentProvider?.modelNames || {})[c.api.model] || c.api.model;
  // 专用模型的显示名：跨提供商选择时也能读出目录名（找不到就显示裸 id）
  const displayOf = (modelId) => {
    const m = String(modelId || '').trim();
    if (!m) return '';
    for (const p of (state.providers || [])) {
      if ((p.modelNames || {})[m]) return `${p.modelNames[m]}`;
    }
    return m;
  };
  const visionModelDisplay = displayOf(c.api.visionModel);
  const videoModelDisplay = displayOf(c.api.videoModel);
  const sc = (typeof setCard === 'function') ? setCard : (o) => `<div class="setcard">${o.body}</div>`;
  return `
    <h3 id="settings-api">模型 API</h3>
    <p class="setsub">选渠道、配降级、算成本 —— 常用项内联，低频项点开折叠卡</p>
    ${sc({
      id: 'card-api-model',
      icon: '🔑',
      title: '模型与渠道',
      sub: '提供商 / 模型 / BaseURL',
      val: esc(c.api.model || '未选模型'),
      open: true,
      body: `
    <div class="field">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="open-model-config-btn">⚙ 模型配置</button>
        <button class="btn" id="open-model-manage-btn">🗂 模型管理</button>
      </div>
      <div class="hint" id="provider-hint" style="margin-top:6px">${currentProvider ? `当前：${esc(currentProvider.displayName)} · ${esc(c.api.model || '未选模型')} @ ${esc(currentProvider.baseURL)}${currentProvider.hasKey ? ' · 已保存 API Key（不显示）' : ' · 未保存 API Key'}` : '尚未选择模型'}</div>
      <div class="hint" id="model-vision-hint" style="margin-top:6px"></div>
      <input type="hidden" id="cfg-provider" value="${esc(c.api.provider || '')}" />
      <input type="hidden" id="cfg-model" value="${esc(c.api.model || '')}" />
      <input type="hidden" id="cfg-baseurl-value" value="${esc(c.api.baseUrl)}" />
    </div>`
    })}
    ${sc({
      id: 'card-api-fallback',
      icon: '🔄',
      gray: true,
      title: '备选模型（故障自动降级）',
      sub: '主模型失败后按顺序重试 · 留空不启用',
      body: `
    <div id="fallback-model-rows"></div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-small" id="add-fallback-row-btn">＋ 添加备选模型</button>
    </div>`
    })}
    ${sc({
      id: 'card-api-bychat-moved',
      icon: '💬',
      gray: true,
      title: '按会话选模型',
      sub: '已并入「人设」页 · 每个群/私聊可单独指定',
      body: `<div class="hint">这一项搬到了 <b>人设</b> 设置页：分会话模式里每个会话一行（人设 + 模型），另有「默认模型（群聊/私聊）」。留空 = 跟随上方主模型。</div>`
    })}
    ${sc({
      id: 'card-api-price',
      icon: '💰',
      gray: true,
      title: '成本核算',
      sub: '官方价表 / 当前单价 / 批量自定义',
      body: `
    <div class="checkbox-row">${switchHtml('cfg-useofficialprice', c.api.useOfficialPrice !== false, '用内置官方价格表估算（按模型 id 自动匹配；走中转站请关掉）')}</div>

    <div class="field" style="margin-top:6px"><label>远程价格表</label>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="muted">官网统一价格表</span>
        <button class="btn btn-small" id="price-feed-refresh-btn" title="从官网拉取最新价格表">拉取价格表</button>
      </div>
      <div class="hint" id="price-feed-status" style="margin-top:4px"></div>
    </div>

    <div class="price-card" id="model-price-card">
      <div class="pc-head">
        <span class="pc-title">当前模型单价</span>
        <span class="pc-model" id="pc-model">${esc(c.api.model || '（未选择模型）')}</span>
      </div>
      <div class="pc-rows">
        <div class="pc-row"><span class="pc-label">输入</span>
          <input type="number" id="cfg-price-in" step="0.01" min="0" value="0" /><span class="pc-unit">元/百万</span></div>
        <div class="pc-row"><span class="pc-label">输出</span>
          <input type="number" id="cfg-price-out" step="0.01" min="0" value="0" /><span class="pc-unit">元/百万</span></div>
        <div class="pc-row"><span class="pc-label">缓存命中</span>
          <input type="number" id="cfg-price-cached" step="0.01" min="0" value="0" /><span class="pc-unit">元/百万</span></div>
      </div>
      <div class="pc-note" id="pc-note"></div>
    </div>

    <div style="display:flex;gap:8px;margin:8px 0">
      <button class="btn btn-small" id="batch-price-btn">批量自定义价格编辑</button>
      <span class="muted" style="font-size:12px;align-self:center">为多个模型分别设定单价</span>
    </div>`
    })}`;
}


function renderSearchSection(c) {
  // 每个提供方区块的初始显隐都要跟当前 provider 一致
  const prov = String(c.webSearch?.provider || 'bing');
  // 自定义搜索提供商列表（可多个），用于动态生成下拉框选项
  const customProvs = Array.isArray(c.webSearch?.providers) ? c.webSearch.providers : [];
  return `
    <h3 id="settings-search">搜索服务</h3>
    <div class="hint" style="margin-bottom:12px">
      当前提供方：${prov === 'bing' ? 'Bing 网页解析' : prov === 'deepseek' ? 'DeepSeek 原生搜索' : prov === 'zhipu' ? '智谱 Web Search' : prov === 'bocha' ? '博查 AI Search' : prov === 'baidu' ? '百度千帆 AI Search' : prov === 'metaso' ? '秘塔 AI 搜索' : '自定义'}
      ${(() => {
        // 当前提供方已保存的 Key 状态（与模型 API 页同款提示口径）
        const keyState = {
          deepseek: c.webSearch?.deepseek?.hasApiKey,
          zhipu: c.webSearch?.zhipu?.hasApiKey,
          bocha: c.webSearch?.bocha?.hasApiKey,
          baidu: c.webSearch?.baidu?.hasApiKey,
          metaso: c.webSearch?.metaso?.hasApiKey
        }[prov];
        if (prov === 'bing') return ' · 无需 API Key';
        if (prov?.startsWith('custom:')) return '';
        return keyState ? ' · 已保存 API Key（不显示）' : ' · 未保存 API Key';
      })()}
    </div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-websearch" ${c.webSearch?.enabled !== false ? 'checked' : ''} />
      <label for="cfg-websearch">联网搜索：启用 web_search / web_fetch 工具</label></div>
    <div class="field"><label>搜索提供方</label>
      <select id="cfg-searchprovider">
        <option value="bing" ${prov === 'bing' ? 'selected' : ''}>Bing 网页解析</option>
        <option value="deepseek" ${prov === 'deepseek' ? 'selected' : ''}>DeepSeek 原生搜索</option>
        <option value="zhipu" ${prov === 'zhipu' ? 'selected' : ''}>智谱 Web Search</option>
        <option value="bocha" ${prov === 'bocha' ? 'selected' : ''}>博查 AI Search</option>
        <option value="baidu" ${prov === 'baidu' ? 'selected' : ''}>百度千帆 AI Search</option>
        <option value="metaso" ${prov === 'metaso' ? 'selected' : ''}>秘塔 AI 搜索</option>
        ${customProvs.map((p) => `<option value="custom:${esc(p.id)}" ${prov === `custom:${p.id}` ? 'selected' : ''}>${esc(p.name || p.baseUrl)}（自定义 · ${p.type === 'bing' ? '网页解析' : 'JSON 接口'}）</option>`).join('')}
      </select></div>
    <div class="field" id="custom-provider-manage" style="${prov.startsWith('custom:') ? '' : 'display:none'}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-small" id="test-search-provider-btn">测试这个搜索服务</button>
        <button class="btn btn-small btn-danger" id="del-search-provider-btn">删除这个搜索服务</button>
        <span id="search-provider-action-hint" class="muted" style="font-size:12px"></span>
      </div>
      <label>API Key${(() => {
        const cp = customProvs.find((p) => `custom:${p.id}` === prov);
        return cp?.hasApiKey ? '（已保存，可查看/替换/清除）' : '（未保存；多数自建服务留空即可）';
      })()}</label>
      <div style="display:flex;gap:8px">
        <input type="password" id="cfg-custom-sp-key" value="${esc(customProvs.find((p) => `custom:${p.id}` === prov)?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
        <button class="btn btn-small" id="cfg-custom-sp-key-toggle" type="button">显示</button>
        <button class="btn btn-small btn-danger" id="cfg-custom-sp-key-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
      </div>
    </div>
    <div class="field" id="bing-search-fields" style="${prov === 'bing' ? '' : 'display:none'}"><label>搜索地址（高级：可替换为兼容 Bing 结果格式的引擎）</label><input type="text" id="cfg-searchurl" value="${esc(c.webSearch?.searchUrl || 'https://cn.bing.com/search')}" /></div>
    <div class="field-row" id="deepseek-search-fields" style="${prov === 'deepseek' ? '' : 'display:none'}">
      <div class="field"><label>DeepSeek 搜索 API Key（留空用环境变量 DEEPSEEK_API_KEY）</label>
        <div style="display:flex;gap:8px">
          <input type="password" id="cfg-ds-searchkey" value="${esc(c.webSearch?.deepseek?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
          <button class="btn btn-small" id="cfg-ds-searchkey-toggle" type="button">显示</button>
          <button class="btn btn-small btn-danger" id="cfg-ds-searchkey-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
        </div></div>
      <div class="field"><label>模型</label><input type="text" id="cfg-ds-searchmodel" value="${esc(c.webSearch?.deepseek?.model || 'deepseek-v4-flash')}" /></div>
    </div>
    <div class="field-row" id="zhipu-search-fields" style="${prov === 'zhipu' ? '' : 'display:none'}">
      <div class="field"><label>智谱 API Key（留空用环境变量 ZHIPU_API_KEY）</label>
        <div style="display:flex;gap:8px">
          <input type="password" id="cfg-zhipu-key" value="${esc(c.webSearch?.zhipu?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
          <button class="btn btn-small" id="cfg-zhipu-key-toggle" type="button">显示</button>
          <button class="btn btn-small btn-danger" id="cfg-zhipu-key-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
        </div></div>
      <div class="field"><label>搜索引擎</label>
        <select id="cfg-zhipu-engine">
          <option value="search_std" ${c.webSearch?.zhipu?.engine === 'search_std' ? 'selected' : ''}>基础版 ¥0.01/次</option>
          <option value="search_pro" ${c.webSearch?.zhipu?.engine === 'search_pro' ? 'selected' : ''}>高级版 ¥0.03/次</option>
          <option value="search_pro_sogou" ${c.webSearch?.zhipu?.engine === 'search_pro_sogou' ? 'selected' : ''}>搜狗版 ¥0.05/次</option>
          <option value="search_pro_quark" ${c.webSearch?.zhipu?.engine === 'search_pro_quark' ? 'selected' : ''}>夸克版 ¥0.05/次</option>
        </select></div>
    </div>
    <div class="field" id="bocha-search-fields" style="${prov === 'bocha' ? '' : 'display:none'}">
      <label>博查 API Key</label>
      <div style="display:flex;gap:8px">
        <input type="password" id="cfg-bocha-key" value="${esc(c.webSearch?.bocha?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
        <button class="btn btn-small" id="cfg-bocha-key-toggle" type="button">显示</button>
        <button class="btn btn-small btn-danger" id="cfg-bocha-key-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
      </div></div>
    <div class="field" id="baidu-search-fields" style="${prov === 'baidu' ? '' : 'display:none'}">
      <label>百度千帆 API Key（留空用环境变量 BAIDU_SEARCH_API_KEY）</label>
      <div style="display:flex;gap:8px">
        <input type="password" id="cfg-baidu-key" value="${esc(c.webSearch?.baidu?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
        <button class="btn btn-small" id="cfg-baidu-key-toggle" type="button">显示</button>
        <button class="btn btn-small btn-danger" id="cfg-baidu-key-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
      </div></div>
    <div class="field" id="metaso-search-fields" style="${prov === 'metaso' ? '' : 'display:none'}">
      <label>秘塔 API Key（可选，留空用官方免费额度 / 环境变量 METASO_API_KEY）</label>
      <div style="display:flex;gap:8px">
        <input type="password" id="cfg-metaso-key" value="${esc(c.webSearch?.metaso?.hasApiKey ? '******' : '')}" placeholder="输入新 Key 可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
        <button class="btn btn-small" id="cfg-metaso-key-toggle" type="button">显示</button>
        <button class="btn btn-small btn-danger" id="cfg-metaso-key-clear" type="button" title="清除已保存的 API Key（留空保存并不会清除，必须点这个按钮）">清除密钥</button>
      </div></div>

    <h3>添加自定义搜索服务</h3>
    <div class="field-row">
      <div class="field"><label>名称（自己辨认用）</label>
        <input type="text" id="new-sp-name" placeholder="例如：自建 SearXNG" /></div>
      <div class="field"><label>类型</label>
        <select id="new-sp-type">
          <option value="openai">JSON 搜索接口（POST）</option>
          <option value="bing">网页解析（Bing 结果格式）</option>
        </select></div>
    </div>
    <div class="field"><label>接口地址 / 搜索页地址</label>
      <input type="text" id="new-sp-baseurl" placeholder="JSON 类型：https://your-search.example.com/search；网页类型：https://your-searx.example.com/search" style="width:100%" /></div>
    <div class="field-row">
      <div class="field"><label>API Key（可选）</label>
        <input type="password" id="new-sp-apikey" placeholder="多数自建服务留空即可" autocomplete="new-password" style="width:100%" /></div>
      <div class="field"><label>模型名（可选）</label>
        <input type="text" id="new-sp-model" placeholder="Responses API 风格才需要" /></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin:8px 0">
      <button class="btn btn-small" id="add-search-provider-btn">＋ 添加并选中</button>
      <span id="add-search-provider-hint" class="muted" style="font-size:12px"></span>
    </div>
  `;
}

function renderMemorySettingsSection(c) {
  const mem = c.memory || {};
  const providers = state.providers || [];
  const useChat = mem.useChatModel !== false;
  const selP = providers.find((p) => p.id === mem.provider);
  const currentDisplay = selP ? `${selP.displayName || selP.id} · ${mem.model || '未选模型'}` : (mem.model || '未选模型');
  return `
    <h3 id="settings-memory">记忆整理</h3>
    <div class="checkbox-row"><input type="checkbox" id="cfg-mem-consolidate" ${mem.consolidateEnabled !== false ? 'checked' : ''} />
      <label for="cfg-mem-consolidate">启用记忆自动整理</label></div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-mem-usechat" ${useChat ? 'checked' : ''} />
      <label for="cfg-mem-usechat">使用与聊天机器人相同的模型</label></div>
    <div id="mem-model-box" style="${useChat ? 'display:none' : ''}">
      <div class="field"><label>记忆整理模型（点击选择）</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="cfg-mem-model-pick" readonly placeholder="点击选择模型" value="${esc(currentDisplay)}" style="flex:1;cursor:pointer" />
        </div>
        <div class="hint" id="mem-model-hint">${selP ? `当前：${esc(selP.displayName)} @ ${esc(selP.baseURL)}` : '尚未选择专用模型'}</div>
        <input type="hidden" id="cfg-mem-provider" value="${esc(mem.provider || '')}" />
        <input type="hidden" id="cfg-mem-model" value="${esc(mem.model || '')}" />
      </div>
    </div>
    <div class="field"><label>整理冷却时间（毫秒）</label><input type="number" id="cfg-mem-interval" min="1800000" step="600000" value="${esc(mem.consolidateMinIntervalMs ?? 21600000)}" /></div>
    <div class="hint">条数超过阈值且距上次整理超过该冷却时间后，才会在运行结束后后台整理。默认 6 小时（21600000 毫秒）。</div>`;
}

function renderPersonaDirectoryItems(c) {
  const contacts = state.personaContacts || {};
  const target = state.personaTarget || 'global';
  const row = (key, name, note, allowed) => {
    const status = allowed === undefined ? '' : allowed ? '已加入聊天白名单' : '未加入聊天白名单';
    const dot = status ? `<i class="persona-whitelist-dot" data-whitelisted="${allowed}" title="${status}" aria-hidden="true"></i>` : '';
    return `<button type="button" class="persona-target${key === target ? ' active' : ''}" data-persona-target="${esc(key)}" aria-pressed="${key === target}" aria-label="${esc(name + '，' + note + (status ? '，' + status : ''))}"><span>${esc(name)}</span><small>${esc(note)}</small>${dot}</button>`;
  };
  const rows = (kind, list) => {
    const byId = new Map((list || []).map(item => [String(item.id), item]));
    const configured = kind === 'group' ? c.allow?.groups : c.allow?.private;
    const whitelist = new Set((configured || []).map(String));
    const savedKeys = [...Object.keys(c.personaByChat || {}), ...Object.keys(c.api?.apiByChat?.byChat || {})];
    const ids = [...new Set([...byId.keys(), ...whitelist, ...savedKeys.filter(key => key.startsWith(kind + ':')).map(key => key.split(':')[1])])];
    return ids.map(id => {
      const item = byId.get(id);
      const name = item?.remark || item?.name || item?.nickname || (kind === 'group' ? '群 ' : '好友 ') + id;
      const allowed = whitelist.has(id);
      return row(kind + ':' + id, name, `${id}${item ? '' : ' · 未同步'}`, allowed);
    }).join('') || '<p class="hint">' + (contacts.loading ? '正在加载…' : kind === 'group' ? '暂无群聊' : '暂无好友') + '</p>';
  };
  return row('global', '默认人设', '所有会话的起点') + '<h3>群聊</h3>' + rows('group', contacts.groups) + '<h3>好友</h3>' + rows('private', contacts.friends);
}

async function loadPersonaContacts({ refresh = false } = {}) {
  const contacts = state.personaContacts ||= { groups: [], friends: [], attempted: false, loading: false, errors: [] };
  if (contacts.loading || (contacts.attempted && !refresh)) return;
  contacts.loading = true; contacts.attempted = true; contacts.errors = [];
  const paint = () => {
    const list = document.querySelector('#view-persona .persona-object-list');
    if (!list) return;
    list.innerHTML = renderPersonaDirectoryItems(state.config || {});
    const status = document.getElementById('persona-contacts-status');
    if (status) status.textContent = contacts.loading ? '正在同步QQ列表…' : contacts.errors.length ? '部分列表未同步：' + contacts.errors.join('；') : `已同步 ${contacts.groups.length} 个群 · ${contacts.friends.length} 位好友`;
    const button = document.getElementById('persona-contacts-refresh');
    if (button) button.disabled = contacts.loading;
    document.querySelector('.persona-studio')?.__personaFilter?.();
  };
  paint();
  const results = await Promise.allSettled(['groups', 'friends'].map(async key => {
    const data = await api('/api/onebot/' + key);
    if (!Array.isArray(data[key])) throw new Error(data.error || 'QQ列表未返回');
    if (!data[key].length && state.status?.onebot?.connected === false) throw new Error('OneBot未连接');
    contacts[key] = data[key];
  }));
  results.forEach((result, index) => {
    if (result.status === 'rejected') contacts.errors.push((index === 0 ? '群聊' : '好友') + '（检查OneBot连接后刷新）');
  });
  contacts.loading = false;
  paint();
}

function renderPersonaSection(c) {
  const target = state.personaTarget || 'global';
  const global = target === 'global';
  const savedPersona = global ? c.persona : (c.personaByChat?.[target] || {});
  const per = { ...savedPersona, ...state.personaDrafts?.[personaRevisionKey(c, target)] };
  const contact = global ? null : (state.personaContacts?.[target.startsWith('group:') ? 'groups' : 'friends'] || []).find(item => String(item.id) === target.split(':')[1]);
  const title = global ? '全局人设' : formatChatTitle(target, contact?.remark || contact?.name || contact?.nickname || chatNameOf(target));
  const templates = Object.entries(state.personaTemplates || {});
  const panel = state.personaPanel || 'role';
  const currentModel = c.api?.apiByChat?.byChat?.[target];
  const missingModel = currentModel?.model && !(state.providers || []).some(p => p.id === currentModel.provider && (p.models || []).includes(currentModel.model));
  const retainedModel = missingModel ? '<option selected value="' + esc(JSON.stringify([currentModel.provider || '', currentModel.model])) + '">' + esc(currentModel.model) + '（目录未加载）</option>' : '';
  const modelOptions = '<option value="">跟随默认模型</option>' + retainedModel + (state.providers || []).map(p => '<optgroup label="' + esc(p.displayName || p.id) + '">' + (p.models || []).map(m => '<option value="' + esc(JSON.stringify([p.id, m])) + '"' + (c.api?.apiByChat?.byChat?.[target]?.model === m && c.api?.apiByChat?.byChat?.[target]?.provider === p.id ? ' selected' : '') + '>' + esc(p.modelNames?.[m] || m) + '</option>').join('') + '</optgroup>').join('');
  const templateName = templates.find(([, p]) => p.text === per.roleText)?.[1]?.name || '自定义正文';
  return `<div class="persona-studio persona-canvas">
    <aside class="persona-directory" aria-label="选择编辑对象">
      <header><h2>人设</h2><p>选择要编辑的对象</p></header>
      <input type="search" id="persona-search" data-persona-filter placeholder="查找群聊或私聊" aria-label="查找编辑对象" value="${esc(state.personaSearch || '')}" autocomplete="off" />
      <div class="persona-directory-sync"><span id="persona-contacts-status">${state.personaContacts?.errors?.length ? 'QQ列表未同步，可刷新重试' : state.personaContacts?.attempted ? 'QQ列表已缓存' : '正在同步QQ列表…'}</span><button type="button" id="persona-contacts-refresh">刷新</button></div>
      <div class="persona-object-list">${renderPersonaDirectoryItems(c)}</div>
      <p class="hint hidden" id="persona-search-empty">没有匹配的对象</p>
    </aside>
    <section class="persona-desk" aria-label="人设编辑器">
      <header class="persona-desk-head"><div><span class="persona-eyebrow">正在编辑 · ${global ? '默认角色' : target.startsWith('group:') ? '群聊角色' : '好友角色'}</span><h2>${esc(global ? '默认人设' : title)}</h2></div><button type="button" class="persona-template-open" data-persona-left="templates"><small>选用人设</small><span id="persona-current-template">${esc(templateName)}</span><b aria-hidden="true">⌄</b></button></header>
      <div class="persona-template-drawer" data-persona-list="templates" hidden aria-label="选择人设模板">
        <header><div><h3>用模板开始</h3><p>选用后填入当前对象的正文和规则</p></div><button type="button" class="btn btn-small" data-persona-left="chats">收起</button></header>
        <div class="persona-template-choices">${templates.map(([id,p]) => `<button type="button" class="persona-template" data-persona-id="${esc(id)}" aria-pressed="${p.text===per.roleText}"><span class="persona-template-name">${esc(p.name)}</span><small>${p.builtin?'内置':'自定义'}</small></button>`).join('')}</div>
        <footer><button type="button" class="btn btn-small" id="new-persona-btn">＋ 新建人设</button><button type="button" class="btn btn-small btn-danger hidden" id="del-persona-btn">删除当前自定义人设</button></footer>
      </div>
      <input type="hidden" id="cfg-persona-pick" value="${esc(templateName)}" /><span id="persona-pick-hint" class="hidden"></span>
      <div class="persona-writing-room">
      <nav class="persona-editor-rail" aria-label="编辑内容">
        ${[['role','角色正文','TA 是谁'],['rules','附加规则','TA 如何回应'],['model','身份与模型','称呼与应用范围']].map(([id,name,note]) => `<button type="button" data-persona-panel="${id}" class="${panel===id?'active':''}" aria-pressed="${panel===id}"><span>${name}</span><small>${note}</small></button>`).join('')}
        <p class="persona-rail-note">${global?'这套人设作为所有会话的默认。':'为左侧选中的对象编辑；空白字段沿用默认人设。'}</p>
      </nav>
      <div class="persona-edit-surface">
      <div class="persona-manual-tools" ${panel==='model'?'hidden':''}><span id="persona-save-status" role="status">${state.personaDrafts?.[personaRevisionKey(c,target)]?'有未保存修改':'已保存'}</span><select id="persona-revisions" data-persona-filter aria-label="最近五次保存的人设"><option value="">最近保存记录</option>${readPersonaRevisions(c,target).map((revision,index)=>`<option value="${index}">${esc(new Date(revision.time).toLocaleString('zh-CN',{hour12:false}))}</option>`).join('')}</select><button type="button" class="btn btn-primary" id="persona-manual-save">保存</button></div>
      <div class="persona-document" data-persona-pane="role" ${panel==='role'?'':'hidden'}><header class="persona-page-heading"><h3>角色正文</h3><p>身份、性格、说话方式，都写在这里。</p></header><textarea id="cfg-roletext" class="persona-role-text" aria-label="角色正文" placeholder="${global?'从一句角色描述开始…':'留空，沿用默认人设'}">${esc(per.roleText || '')}</textarea><footer><span>修改后点击保存 · 快捷键：Ctrl+S 快速保存，Ctrl+Z 撤销，Ctrl+Y 重做</span><span id="persona-character-count">${(per.roleText || '').length} 字</span></footer></div>
      <div class="persona-options" data-persona-pane="rules" ${panel==='rules'?'':'hidden'}>
        <header class="persona-page-heading"><h3>回应规则</h3><p>在角色正文之外，补充需要遵守的约定。</p></header>
        <div class="field"><label for="cfg-customrules">附加规则</label><textarea id="cfg-customrules" class="persona-role-text" placeholder="${global?'补充角色应遵守的规则':'留空，沿用默认规则'}">${esc(per.customRules || '')}</textarea></div>
        <details class="persona-advanced" ${per.systemPromptOverride?'open':''}><summary>高级：系统提示词覆盖</summary><div class="field"><label for="cfg-sysprompt">系统提示词覆盖</label><p class="hint">可选。填写后整体替换默认提示词；留空沿用默认。支持 {botName}、{roleText}、{participation}。</p><textarea id="cfg-sysprompt" class="persona-role-text">${esc(per.systemPromptOverride || '')}</textarea></div></details>
      </div>
      <div class="persona-options" data-persona-pane="model" ${panel==='model'?'':'hidden'}>
        <header class="persona-page-heading"><h3>身份与模型</h3><p>调整角色的称呼、参与方式和使用范围。</p></header>
        <h3>角色行为</h3><div class="field-row">${global?`<div class="field"><label for="cfg-botname">机器人名字</label><input id="cfg-botname" value="${esc(per.botName || '')}" /></div><div class="field"><label for="cfg-selfnick">群内展示名</label><input id="cfg-selfnick" value="${esc(per.selfNickname || '')}" /></div>`:''}<div class="field"><label for="cfg-participation">参与度</label><select id="cfg-participation">${global?'':'<option value="">沿用默认</option>'}${[['low','安静型'],['medium','普通群友'],['high','活跃型']].map(([id,name])=>`<option value="${id}" ${per.participation===id?'selected':''}>${name}</option>`).join('')}</select></div></div>
        <h3>模型</h3>${global?'<div id="apibychat-rows"></div>':`<div class="field"><label for="cfg-persona-chat-model">当前会话</label><select id="cfg-persona-chat-model">${modelOptions}</select></div>`}
        <h3>应用范围</h3><div class="checkbox-row"><input type="checkbox" id="cfg-persona-unified" ${c.personaUnified!==false?'checked':''} /><label for="cfg-persona-unified">所有会话统一使用默认人设</label></div><p class="hint">关闭后，各会话的独立人设生效。已编辑的内容会保留。</p>
      </div>
      </div></div>
      <footer class="persona-editor-status">${!global?`<span class="persona-scope-note" id="persona-unified-note" ${c.personaUnified!==false?'':'hidden'}>统一模式开启 · 当前使用默认人设，可在“身份与模型”调整。</span>`:'<span>默认人设 · 未单独配置的会话使用这套内容</span>'}</footer>
    </section>
  </div>`;

}

/**
 * 「全局人设设置」模态框（2026-09-18）：统一人设关闭（分群模式）时，
 * persona 主编辑器不在场 —— 没有独立人设的会话跟随的全局字段就没了编辑入口。
 * 这里弹出同款字段（选择人设 / 参与度 / 角色设定 / 附加规则 / 系统提示覆盖 /
 * 机器人名字 / 群内展示名），保存直接 POST /api/config 的 persona 补丁。
 */
function openGlobalPersonaModal() {
  const c = state.config || {};
  const per = c.persona || {};
  const overlay = modelModalShell({
    head: '全局人设设置',
    body: `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input type="text" id="gp-pick" readonly placeholder="点击选择人设" value="${esc(Object.values(state.personaTemplates || {}).find((p) => p.text === (per.roleText || ''))?.name || '')}" style="flex:1;cursor:pointer" />
        <button class="btn btn-small" id="gp-new-btn">＋ 添加人设</button>
      </div>
      <div class="field-row">
        <div class="field"><label>机器人名字</label><input type="text" id="gp-botname" value="${esc(per.botName || '')}" /></div>
        <div class="field"><label>群内展示名（可选）</label><input type="text" id="gp-selfnick" value="${esc(per.selfNickname || '')}" /></div>
        <div class="field"><label>参与度</label>
          <select id="gp-participation">
            <option value="low" ${per.participation === 'low' ? 'selected' : ''}>安静型</option>
            <option value="medium" ${per.participation === 'medium' ? 'selected' : ''}>普通群友</option>
            <option value="high" ${per.participation === 'high' ? 'selected' : ''}>活跃型</option>
          </select></div>
      </div>
      <div class="field"><label>角色设定</label>
        <textarea id="gp-roletext" class="persona-role-text" style="min-height:180px" placeholder="例如：你是运维群里的老油条……">${esc(per.roleText || '')}</textarea></div>
      <div class="field"><label>管理员附加规则（可选，追加到系统提示）</label>
        <textarea id="gp-customrules" class="persona-role-text" style="min-height:80px">${esc(per.customRules || '')}</textarea></div>
      <div class="field"><label>系统提示词覆盖（高级 · 可选）</label>
        <textarea id="gp-sysprompt" class="persona-role-text" style="min-height:80px" placeholder="留空 = 使用内置默认系统提示词">${esc(per.systemPromptOverride || '')}</textarea></div>
      <div class="hint" style="margin-top:6px">未配置独立人设的群聊/私聊全部使用这套全局字段。</div>`,
    foot: `<span class="hint" id="gp-status" style="margin-right:auto">改动会自动保存</span>
           <button class="btn" id="gp-cancel">取消</button>
           <button class="btn btn-primary" id="gp-save">保存</button>`
  });

  // 选择人设：与统一编辑器同一份模板列表
  overlay.querySelector('#gp-pick').addEventListener('click', () => {
    const entries = Object.entries(state.personaTemplates || {});
    if (!entries.length) return;
    const pickOverlay = modelModalShell({
      head: '选择人设',
      body: `<div class="model-modal-right" style="flex:1">
        ${entries.map(([id, p]) => `
          <div class="mm-model" data-id="${esc(id)}">
            <span class="mm-check">${p.text === overlay.querySelector('#gp-roletext').value ? '✓' : ''}</span>
            <span>${esc(p.name)}</span>
            <span class="muted" style="font-size:11px">${p.builtin ? '内置' : '自定义'}</span>
          </div>`).join('')}
      </div>`,
      foot: `<button class="btn" id="pp-cancel">取消</button>`
    });
    pickOverlay.querySelectorAll('.mm-model').forEach((el) => {
      el.addEventListener('click', () => {
        const tpl = state.personaTemplates[el.dataset.id];
        if (tpl) {
          overlay.querySelector('#gp-roletext').value = tpl.text;
          overlay.querySelector('#gp-customrules').value = tpl.customRules || '';
          overlay.querySelector('#gp-pick').value = tpl.name;
        }
        closeModelModal(pickOverlay);
      });
    });
    pickOverlay.querySelector('#pp-cancel').addEventListener('click', () => closeModelModal(pickOverlay));
  });
  overlay.querySelector('#gp-new-btn').addEventListener('click', () => {
    openPersonaCreateModal();
  });

  overlay.querySelector('#gp-cancel').addEventListener('click', () => closeModelModal(overlay));
  // ── 实时保存：改完不用点「保存」也立刻生效（900ms 防抖；下拉/开关 200ms）──
  // 之前只有点「保存」才 POST，用户以为"人设改不了"（弹窗字段不在 #settings-form 内，
  // 那套表单自动保存链到不了这里）。
  const gpStatus = overlay.querySelector('#gp-status');
  const gpPatch = () => ({
    persona: {
      ...(state.config?.persona || {}),
      botName: overlay.querySelector('#gp-botname').value.trim() || '小鲸鱼',
      selfNickname: overlay.querySelector('#gp-selfnick').value.trim(),
      participation: overlay.querySelector('#gp-participation').value,
      roleText: overlay.querySelector('#gp-roletext').value.trim(),
      customRules: overlay.querySelector('#gp-customrules').value.trim(),
      systemPromptOverride: overlay.querySelector('#gp-sysprompt').value.trim()
    }
  });
  let gpTimer = null;
  const gpAutoSave = async () => {
    try {
      const r = await api('/api/config', { method: 'POST', body: JSON.stringify(gpPatch()) });
      if (r?.config) state.config = r.config;
      if (gpStatus) gpStatus.textContent = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    } catch (e) {
      if (gpStatus) gpStatus.textContent = `自动保存失败：${e?.message || e}`;
    }
  };
  for (const sel of ['#gp-roletext', '#gp-customrules', '#gp-sysprompt', '#gp-botname', '#gp-selfnick']) {
    overlay.querySelector(sel)?.addEventListener('input', () => {
      if (gpTimer) clearTimeout(gpTimer);
      gpTimer = setTimeout(() => { void gpAutoSave(); }, 900);
    });
  }
  overlay.querySelector('#gp-participation')?.addEventListener('change', () => {
    if (gpTimer) clearTimeout(gpTimer);
    gpTimer = setTimeout(() => { void gpAutoSave(); }, 200);
  });
  overlay.querySelector('#gp-save').addEventListener('click', async () => {
    const patch = {
      persona: {
        ...(c.persona || {}),
        botName: overlay.querySelector('#gp-botname').value.trim() || '小鲸鱼',
        selfNickname: overlay.querySelector('#gp-selfnick').value.trim(),
        participation: overlay.querySelector('#gp-participation').value,
        roleText: overlay.querySelector('#gp-roletext').value.trim(),
        customRules: overlay.querySelector('#gp-customrules').value.trim(),
        systemPromptOverride: overlay.querySelector('#gp-sysprompt').value.trim()
      }
    };
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify(patch) });
      closeModelModal(overlay);
      loadSettings();
    } catch (e) {
      alert(`保存全局人设失败：${e.message}`);
    }
  });
}

/**
 * 分会话人设编辑模态框：与统一编辑器同款字段（人设选择/添加/机器人名字沿用全局说明/参与度/
 * 角色设定/附加规则/系统提示词覆盖）。保存按钮直接 POST /api/config 落盘
 * （personaByChat 整体 __replace__），不经过表单自动保存链。
 */
function openPerChatPersonaModal(chatKey) {
  const conf = (state.config?.personaByChat || {})[chatKey] || {};
  const chatName = formatChatTitle(chatKey, chatNameOf(chatKey));
  // 本会话的模型（apiByChat.byChat[chatKey]）：与独立人设同一套「每个会话一份」的思路
  const byChatMap = state.config?.api?.apiByChat?.byChat || {};
  let pcModel = {
    model: String(byChatMap[chatKey]?.model || ''),
    provider: String(byChatMap[chatKey]?.provider || '')
  };
  const modelText = () => {
    if (!pcModel.model) return '跟随默认模型';
    const p = (state.providers || []).find((x) => x.id === pcModel.provider);
    const name = (p?.modelNames || {})[pcModel.model] || pcModel.model;
    return p ? `${name} @ ${p.displayName || p.id}` : name;
  };
  const overlay = modelModalShell({
    head: `${chatName} 的独立人设与模型`,
    body: `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input type="text" id="pcp-pick" readonly placeholder="点击选择人设" value="${esc(conf.roleText ? (Object.values(state.personaTemplates || {}).find((p) => p.text === conf.roleText)?.name || '自定义') : '')}" style="flex:1;cursor:pointer" />
        <button class="btn btn-small" id="pcp-new-btn">＋ 添加人设</button>
      </div>
      <div class="field"><label>本会话使用的模型（留空 = 跟随默认模型）</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span id="pcp-model-text" style="flex:1;min-width:200px">${esc(modelText())}</span>
          <button class="btn btn-small" id="pcp-model-pick">选择</button>
          <button class="btn btn-small" id="pcp-model-clear" ${pcModel.model ? '' : 'disabled'}>清除</button>
        </div>
      </div>
      <div class="field"><label>参与度（留空跟随全局）</label>
        <select id="pcp-participation">
          <option value="" ${!conf.participation ? 'selected' : ''}>跟随全局</option>
          <option value="low" ${conf.participation === 'low' ? 'selected' : ''}>安静型</option>
          <option value="medium" ${conf.participation === 'medium' ? 'selected' : ''}>普通群友</option>
          <option value="high" ${conf.participation === 'high' ? 'selected' : ''}>活跃型</option>
        </select></div>
      <div class="field"><label>角色设定（留空跟随全局）</label>
        <textarea id="pcp-roletext" class="persona-role-text" style="min-height:180px" placeholder="留空 = 用全局人设的角色设定">${esc(conf.roleText || '')}</textarea></div>
      <div class="field"><label>管理员附加规则（可选）</label>
        <textarea id="pcp-customrules" style="min-height:80px" placeholder="可选：追加到系统提示的规则（留空 = 用全局）">${esc(conf.customRules || '')}</textarea></div>
      <div class="field"><label>系统提示词覆盖（高级 · 可选）</label>
        <textarea id="pcp-sysprompt" style="min-height:80px" placeholder="可选：整体替换系统提示（留空 = 用全局）">${esc(conf.systemPromptOverride || '')}</textarea></div>
      <div class="hint" style="margin-top:6px">机器人名字/群内展示名不按会话变化（账号身份，改了会与 @ 判定对不上），在统一人设里设置。</div>`,
    foot: `<span class="hint" id="pcp-status" style="margin-right:auto">改动会自动保存</span>
           <button class="btn" id="pcp-clear">清空独立人设</button>
           <button class="btn" id="pcp-cancel">取消</button>
           <button class="btn btn-primary" id="pcp-save">保存</button>`
  });

  // 选择人设：复用人设模板列表
  overlay.querySelector('#pcp-pick').addEventListener('click', () => {
    const entries = Object.entries(state.personaTemplates || {});
    if (!entries.length) return;
    const pickOverlay = modelModalShell({
      head: '选择人设',
      body: `<div class="model-modal-right" style="flex:1">
        ${entries.map(([id, p]) => `
          <div class="mm-model" data-id="${esc(id)}">
            <span class="mm-check">${p.text === overlay.querySelector('#pcp-roletext').value ? '✓' : ''}</span>
            <span>${esc(p.name)}</span>
            <span class="muted" style="font-size:11px">${p.builtin ? '内置' : '自定义'}</span>
          </div>`).join('')}
      </div>`,
      foot: `<button class="btn" id="pp-cancel">取消</button>`
    });
    pickOverlay.querySelectorAll('.mm-model').forEach((el) => {
      el.addEventListener('click', () => {
        const tpl = state.personaTemplates[el.dataset.id];
        if (tpl) {
          overlay.querySelector('#pcp-roletext').value = tpl.text;
          overlay.querySelector('#pcp-customrules').value = tpl.customRules || '';
          overlay.querySelector('#pcp-pick').value = tpl.name;
        }
        closeModelModal(pickOverlay);
      });
    });
    pickOverlay.querySelector('#pp-cancel').addEventListener('click', () => closeModelModal(pickOverlay));
  });
  overlay.querySelector('#pcp-new-btn').addEventListener('click', () => {
    // 复用统一编辑器的添加流程：加完模板直接填进本会话的角色设定
    openPersonaCreateModal();
  });

  // 直接 POST 落盘：不走"写隐藏 JSON + 等表单链保存"的老路。
  // 老路的两个坑（2026-09-17 用户实测）：
  //   1. modal 挂在 body 下、不在 #settings-form 内，dispatchEvent(change) 冒泡
  //      到不了 form 的委托监听 —— 从来没触发过自动保存；
  //   2. 就算触发了，随后的 loadSettings() 重建表单 DOM，隐藏 input 被重渲染成
  //      GET 回来的旧值，用户刚写的条目被无声丢弃 → 重开 modal 一片空白。
  const saveToMap = async (entry) => {
    const current = state.config?.personaByChat || {};
    const next = { ...current };
    if (entry) next[chatKey] = entry; else delete next[chatKey];
    // 模型与人设一起落盘：byChat 用 __replace__ 整体替换（deepMerge 传 {} 删不掉已有键）
    const nextByChat = { ...(state.config?.api?.apiByChat?.byChat || {}) };
    if (pcModel.model) nextByChat[chatKey] = { model: pcModel.model, provider: pcModel.provider || '' };
    else delete nextByChat[chatKey];
    try {
      const r = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          personaByChat: { __replace__: next },
          api: { apiByChat: { byChat: { __replace__: nextByChat } } }
        })
      });
      if (r?.config) state.config = r.config;
    } catch (e) {
      alert(`保存独立人设失败：${e?.message || e}`);
      throw e;
    }
  };

  // 本会话模型：复用模型目录选择器
  overlay.querySelector('#pcp-model-pick').addEventListener('click', () => {
    const providers = state.providers || [];
    if (!providers.length) { alert('模型目录为空：请先在「模型 API」页添加提供商。'); return; }
    const pick = modelModalShell({
      head: `选择「${chatName}」使用的模型`,
      body: `<div class="model-modal-left" id="mm-left"></div><div class="model-modal-right" id="mm-right"></div>`,
      foot: `<button class="btn" id="mm-cancel">取消</button>`
    });
    const left = pick.querySelector('#mm-left');
    const right = pick.querySelector('#mm-right');
    let activePid = pcModel.provider || providers[0].id;
    const renderLeft = () => {
      left.innerHTML = providers.map((p) =>
        `<div class="mm-prov ${p.id === activePid ? 'active' : ''}" data-pid="${esc(p.id)}">${esc(p.displayName || p.id)}</div>`).join('');
      left.querySelectorAll('.mm-prov').forEach((el) => {
        el.addEventListener('click', () => { activePid = el.dataset.pid; renderLeft(); renderRight(); });
      });
    };
    const renderRight = () => {
      const p = providers.find((x) => x.id === activePid);
      if (!p) { right.innerHTML = ''; return; }
      const names = p.modelNames || {};
      right.innerHTML = (p.models || []).map((m) => `
        <div class="mm-model" data-model="${esc(m)}">
          <span class="mm-check">${m === pcModel.model ? '✓' : ''}</span>
          <span>${esc(names[m] || m)}</span>
          <span class="muted" style="font-size:11px">${esc(m)}</span>
        </div>`).join('') || '<div class="muted" style="padding:10px">该提供商下没有模型</div>';
      right.querySelectorAll('.mm-model').forEach((el) => {
        el.addEventListener('click', () => {
          pcModel = { model: el.dataset.model, provider: activePid };
          closeModelModal(pick);
          const textEl = overlay.querySelector('#pcp-model-text');
          if (textEl) textEl.textContent = modelText();
          const clearBtn = overlay.querySelector('#pcp-model-clear');
          if (clearBtn) clearBtn.disabled = false;
          void pcpAutoSave();   // 选完立即落盘（不必再点保存）
        });
      });
    };
    renderLeft();
    renderRight();
    pick.querySelector('#mm-cancel').addEventListener('click', () => closeModelModal(pick));
  });
  overlay.querySelector('#pcp-model-clear').addEventListener('click', () => {
    pcModel = { model: '', provider: '' };
    const textEl = overlay.querySelector('#pcp-model-text');
    if (textEl) textEl.textContent = modelText();
    overlay.querySelector('#pcp-model-clear').disabled = true;
    void pcpAutoSave();
  });

  // ── 实时保存：人设字段与模型改动都会自动落盘（900ms 防抖）──
  const pcpStatus = overlay.querySelector('#pcp-status');
  const pcpEntry = () => {
    const entry = {};
    const roleText = overlay.querySelector('#pcp-roletext').value.trim();
    const participation = overlay.querySelector('#pcp-participation').value;
    const customRules = overlay.querySelector('#pcp-customrules').value.trim();
    const sysPrompt = overlay.querySelector('#pcp-sysprompt').value.trim();
    if (roleText) entry.roleText = roleText;
    if (participation) entry.participation = participation;
    if (customRules) entry.customRules = customRules;
    if (sysPrompt) entry.systemPromptOverride = sysPrompt;
    return Object.keys(entry).length ? entry : null;
  };
  let pcpTimer = null;
  async function pcpAutoSave() {
    try {
      await saveToMap(pcpEntry());
      if (pcpStatus) pcpStatus.textContent = `已自动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    } catch {
      if (pcpStatus) pcpStatus.textContent = '自动保存失败（见弹窗提示）';
    }
  }
  for (const sel of ['#pcp-roletext', '#pcp-customrules', '#pcp-sysprompt']) {
    overlay.querySelector(sel)?.addEventListener('input', () => {
      if (pcpTimer) clearTimeout(pcpTimer);
      pcpTimer = setTimeout(() => { void pcpAutoSave(); }, 900);
    });
  }
  overlay.querySelector('#pcp-participation')?.addEventListener('change', () => {
    if (pcpTimer) clearTimeout(pcpTimer);
    pcpTimer = setTimeout(() => { void pcpAutoSave(); }, 200);
  });

  overlay.querySelector('#pcp-cancel').addEventListener('click', () => closeModelModal(overlay));
  overlay.querySelector('#pcp-clear').addEventListener('click', async () => {
    try { await saveToMap(null); } catch { return; }
    closeModelModal(overlay);
    renderSettings();   // 只刷人设区块（按钮上的 ● 标记），不整页重拉 7 个接口
  });
  overlay.querySelector('#pcp-save').addEventListener('click', async () => {
    const roleText = overlay.querySelector('#pcp-roletext').value.trim();
    const participation = overlay.querySelector('#pcp-participation').value;
    const customRules = overlay.querySelector('#pcp-customrules').value.trim();
    const sysPrompt = overlay.querySelector('#pcp-sysprompt').value.trim();
    if (!roleText && !participation && !customRules && !sysPrompt) {
      try { await saveToMap(null); } catch { return; }   // 全空 = 清除独立人设
    } else {
      const entry = {};
      if (roleText) entry.roleText = roleText;
      if (participation) entry.participation = participation;
      if (customRules) entry.customRules = customRules;
      if (sysPrompt) entry.systemPromptOverride = sysPrompt;
      try { await saveToMap(entry); } catch { return; }
    }
    closeModelModal(overlay);
    renderSettings();
  });
}

function renderAllowSection(c) {
  return `
    <h3 id="settings-allow">聊天白名单</h3>
    <div class="hint" style="margin-bottom:10px">白名单为空时机器人不会在任何群聊/私聊内运行。</div>
    <div class="field"><label>从 QQ 账号直接勾选</label>
      <div class="allow-pick-row">
        <button class="btn btn-small" id="pick-groups-btn">选择群</button>
        <button class="btn btn-small" id="pick-friends-btn">选择好友</button>
        <span id="pick-result" class="muted allow-pick-msg"></span>
      </div></div>
    <div class="field-row">
      <div class="field"><label>允许的群号（逗号分隔）</label><input type="text" id="cfg-allowgroups" value="${esc((c.allow.groups || []).join(','))}" /></div>
      <div class="field"><label>允许的 QQ（逗号分隔）</label><input type="text" id="cfg-allowprivate" value="${esc((c.allow.private || []).join(','))}" /></div>
    </div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-allowallwhenempty" ${c.allowAllWhenEmpty === true ? 'checked' : ''} />
      <label for="cfg-allowallwhenempty">白名单留空时允许所有会话</label></div>
    <div class="hint">说明：勾选后，若上方两个列表都为空，机器人会在<b>所有</b>群聊和私聊中运行；只要填了任意一项，就只按名单过滤。</div>
    <div class="hint" style="margin-top:8px">按会话的独立人设在「人设」页签配置（关闭"统一人设"后出现）。</div>`;
}

// 表情包积极程度档位：[值, 显示名]
const STICKER_LEVELS = [
  [0, '0 · 不鼓励（只在很贴切时偶尔用）'],
  [1, '1 · 偶尔（合适时配一张）'],
  [2, '2 · 较积极（优先考虑配图）'],
  [3, '3 · 很积极（表情包爱好者）']
];

// 读取历史档位：名称与说明（档位制，累积生效）
/** 把输入钳制到 [min,max]，非法值退回 fallback。 */
/**
 * 取会话的群名（群聊才有）。
 * 群名由后端 /api/chats 附带（走 OneBot get_group_info，带缓存与超时保护），
 * 拿不到就返回空串 —— 调用方会自动退回只显示群号。
 */
function chatNameOf(chatKey) {
  const c = (state.chats || []).find((x) => x.key === chatKey);
  return String(c?.chatName || '').trim();
}

/**
 * 会话标题：群名 / 私聊昵称
 * 侧栏只显示名字（过长由 CSS 省略号截断），不拼群号 —— 拼了会被挤爆。
 * 拿不到名字时才退回「群 123 / 私聊 123」兜底。
 */
function formatChatTitle(chatKey, name = '') {
  const n = String(name || '').trim();
  if (n) return n;
  const m = /^group:(\d+)$/.exec(String(chatKey || ''));
  if (m) return `群 ${m[1]}`;
  const p = /^private:(\d+)$/.exec(String(chatKey || ''));
  if (p) return `私聊 ${p[1]}`;
  return String(chatKey || '');
}

/** 详情页标题：名字 + 号（需要确认身份时用） */
function formatChatTitleWithId(chatKey, name = '') {
  const m = /^group:(\d+)$/.exec(String(chatKey || ''));
  if (m) return name ? `${name}（${m[1]}）` : `群 ${m[1]}`;
  const p = /^private:(\d+)$/.exec(String(chatKey || ''));
  if (p) return name ? `${name}（${p[1]}）` : `私聊 ${p[1]}`;
  return formatChatTitle(chatKey, name);
}

/**
 * 群名补底缓存（id → 群名）：/api/onebot/groups 的群列表名字。
 * 没有消息存档的白名单群在 /api/chats 里查不到名字，分群按钮会退化成「群 <号>」，
 * 不方便辨识 —— 这里用 OneBot 群列表把名字补齐。
 */
async function loadQqGroupNames() {
  if (state.qqGroupNamesLoading) return state.qqGroupNames || {};
  state.qqGroupNamesLoading = true;
  try {
    const data = await api('/api/onebot/groups');
    state.qqGroupNames = state.qqGroupNames || {};
    for (const g of data.groups || []) {
      const id = String(g?.id ?? '').trim();
      const name = String(g?.name ?? '').trim();
      if (id && name) state.qqGroupNames[id] = name;
    }
  } catch { /* OneBot 未连接时静默：退回群号兜底 */ }
  finally { state.qqGroupNamesLoading = false; }
  return state.qqGroupNames || {};
}

/** 分群场景的群显示名：**仅群名**（拿不到才退回「群 <号>」兜底）。 */
function groupDisplayName(gid) {
  const id = String(gid ?? '').trim();
  const n = chatNameOf(`group:${id}`) || String(state.qqGroupNames?.[id] || '').trim();
  return n || `群 ${id}`;
}

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/*
 * 滑条换算（前端显示用）。
 *
 * 换算逻辑来自 /vendor/tier-slider.js（与 src/tier-slider.js 同一份镜像）。
 * 后端保存配置时会用它**重新权威换算**档位与概率，前端这里只负责界面即时反馈。
 * 下面的 sliderToTierUI / sliderToTierUI_tierToSlider 是对共享函数的薄封装，
 * 保持既有调用点签名不变。
 */
function sliderToTierUI(pos) {
  return sliderToTier(pos);
}

/** 已保存配置 → 滑条位置（优先用存下来的位置，老配置没有就从 tier/概率反推）。 */
function sliderToTierUI_tierToSlider(st) {
  const saved = Number(st?.contextSliderPos);
  if (Number.isFinite(saved)) return Math.min(100, Math.max(0, saved));
  return tierToSlider(st?.contextTier, st?.randomPercent);
}

/** 滑条位置 → 一句话说明（给用户的即时反馈）。 */
function sliderDesc(pos) {
  const { tier, randomPercent } = sliderToTierUI(pos);
  if (tier === 1) return '<b>1 档 · 仅艾特</b>：只有被 @ 时才响应，其余消息标记已读、不调模型（最省）';
  if (tier === 2) return '<b>2 档 · +关键词</b>：被 @ 或命中关键词时响应';
  // 3 档概率展示必须与后端判定同源：resolveContextTier 用 Math.random()*100 与
  // randomPercent 比较（即"骰子值 < 阈值"），滑条换算出的 randomPercent 就是这个阈值。
  // 之前这里展示的是 sliderToTier 的 randomPercent 四舍五入值，而后端在保存时会
  // 重新权威换算一次 —— 两边都来自同一公式，但旧版 desc 里取整方式不同导致偶发不一致，
  // 现在统一保留一位小数（与 sliderToTier 一致）。
  if (tier === 3) return `<b>3 档 · +随机</b>：被 @ / 关键词必响应；此外每批普通消息有 <b>${randomPercent}%</b> 概率响应`;
  return '<b>4 档 · 全响应</b>：任何消息都响应，且艾特/关键词/随机的判定全部失效';
}

const TIER_NAME = { 1: '仅艾特', 2: '+关键词', 3: '+随机', 4: '全响应' };

/** 滑条位置 → 纯文本档位名（无 HTML 标签，供双点滑条说明文字使用）。 */
function sliderDescText(pos) {
  const { tier, randomPercent } = sliderToTierUI(pos);
  if (tier === 3) return `3 档 · +随机（${randomPercent}%）`;
  return `${tier} 档 · ${TIER_NAME[tier]}`;
}
const TIER_HINT = {
  1: '只有被 @ 时才响应，其余消息标记已读、不调模型（最省 token）',
  2: '在 1 档基础上，命中关键词也响应',
  3: '在 2 档基础上，再按概率随机响应一些消息',
  4: '任何消息都响应（改造前的行为，最费 token）'
};

function renderChatSection(c) {
  const st = c.store || {};
  const fold = (typeof setCard === 'function') ? setCard : (o) => `<div class="setcard">${o.body}</div>`;
return `
    <h3>聊天设置</h3>
    ${fold({
      id: 'card-send-config',
      icon: '📨',
      title: '信息发送配置',
      sub: '温度 / 思考 / 节奏 / 发送限流',
      body: `
      <div class="field-row">
        <div class="field"><label>温度</label><input type="number" id="sc-temperature" step="0.1" min="0" max="2" value="${esc(c.api?.temperature ?? 0.8)}" /></div>
        <div class="field"><label>单次运行最大工具轮数</label><input type="number" id="sc-maxrounds" min="1" max="40" value="${esc(c.api?.maxRounds ?? 12)}" /></div>
      </div>
      <div class="field"><label>思考强度</label>
        <select id="sc-thinking-effort">
          ${[
            ['off', '关（不思考，明确关闭）'],
            ['', '默认（跟随模型/网关）'],
            ['on-noeffort', '开（明确开启，不指定强度）'],
            ['low', '低（快、省 token）'],
            ['medium', '中'],
            ['high', '高（慢、细致）'],
            ['xhigh', '超高（更慢、更深入）'],
            ['max', '拉满（最强推理）']
          ].map(([v, l]) => {
            const eff = c.api?.thinkingEffort || '';
            const mode = c.api?.thinkingMode || 'auto';
            // (mode, effort) 二维状态压成一维下拉：off 优先，其次 effort 档；
            // "on 但没指定强度"是独立档 on-noeffort（不能折叠进"默认"——
            // 那样一次保存会把明确开启改写成 auto，见 saveConfig chat 分支）。
            const sel = mode === 'off' ? 'off' : (eff || (mode === 'on' ? 'on-noeffort' : ''));
            return `<option value="${v}" ${sel === v ? 'selected' : ''}>${l}</option>`;
          }).join('')}
        </select>
        <div class="hint">内置落成各厂商思考参数（off~max 六档）；渠道不支持高档时向下就近映射。</div></div>
      <div class="field-row">
        <div class="field"><label>防抖聚批窗口（毫秒）</label><input type="number" id="sc-wakedelay" min="0" value="${esc(c.wakeDelayMs)}" /></div>
        <div class="field"><label>批次间隔（毫秒）</label><input type="number" id="sc-draindelay" min="0" value="${esc(c.drainDelayMs)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>同时处理几个会话</label><input type="number" id="sc-maxruns" min="1" max="8" value="${esc(c.maxConcurrentRuns)}" /></div>
        <div class="field"><label>失败自动重试次数</label><input type="number" id="sc-sessionretry" min="0" max="5" value="${esc(c.sessionRetryAttempts ?? 2)}" />
          <div class="hint">0 = 关闭。已发出过消息的会话绝不自动重试。</div></div>
      </div>
      <div class="field-row">
        <div class="field"><label>相邻消息最小间隔（毫秒）</label><input type="number" id="sc-mingap" min="200" value="${esc(c.send?.minGapMs ?? 1000)}" /></div>
        <div class="field"><label>最大间隔（毫秒）</label><input type="number" id="sc-maxgap" min="500" value="${esc(c.send?.maxGapMs ?? 3000)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>每分钟最多发送</label><input type="number" id="sc-maxpermin" min="1" value="${esc(c.send?.maxPerMinute ?? 80)}" /></div>
        <div class="field"><label>每小时最多发送</label><input type="number" id="sc-maxperhour" min="1" value="${esc(c.send?.maxPerHour ?? 500)}" /></div>
      </div>
      <div class="hint">改动即时生效（自动保存），无需单独点保存。</div>`
    })}
    ${fold({
      id: 'card-active-config',
      icon: '⚡',
      title: '活跃设置',
      sub: '响应档位 / 峰谷',
      val: tierSummary(sliderToTierUI_tierToSlider(st)),
      // 卡头插槽：竖分割线 + 三件套（峰谷时段 / 档位参数 / 统一设置），
      // 紧贴标题块左侧排布，与右上角档位摘要之间留白。
      extra: `<span class="ac-head-controls"><span class="ac-head-div"></span>
        <div class="btn ac-peak-btn" id="ac-peak-btn" role="button" tabindex="0" title="点击设置高峰时段（开始 / 结束与预设方案）">
          <span>🌅 峰谷时段</span>
          <label class="switch ac-peak-switch" title="启用 / 停用峰谷切换（高峰时段用高峰档，其余时间用低谷档）"><input type="checkbox" id="ac-peak-enabled" ${st.peakSchedule?.enabled === true ? 'checked' : ''} /><span class="track"><span class="thumb"></span></span></label>
        </div>
        <button class="btn" id="ac-tier-params-btn" title="档位参数：各档条数 / 关键词表 / 被召唤后持续参与">⚙ 档位参数</button>
        <label class="switch" style="padding:0" title="开 = 所有群共用同一套档位 / 峰谷时段；关 = 每个群单独设置"><input type="checkbox" id="ac-unifiedtier" ${st.unifiedTier !== false ? 'checked' : ''} /><span class="track"><span class="thumb"></span></span><span style="font-size:12px">统一设置</span></label>
      </span>`,
      open: true,
      body: `<div id="ac-editor"></div>`
    })}

    ${fold({
      id: 'card-cmdmute',
      icon: '🔇',
      title: '指令禁言',
      sub: '被 @ 附带指令就安静一段时间',
      open: false,
      body: `
      <div class="field-row">
        <div class="field"><label>禁言指令（需与 @机器人 同条消息）</label>
          <input type="text" id="ac-cmdmute-command" value="${esc(c.commandMute?.command || '/安静')}" placeholder="如 /安静" /></div>
        <div class="field"><label>禁言时长（分钟，0 = 直到手动解除）</label>
          <input type="number" id="ac-cmdmute-duration" min="0" value="${esc(Number(c.commandMute?.durationMin ?? 30))}" /></div>
      </div>
      <div class="checkbox-row"><input type="checkbox" id="ac-cmdmute-enabled" ${c.commandMute?.enabled !== false ? 'checked' : ''} />
        <label for="ac-cmdmute-enabled">启用指令禁言</label></div>
      <div class="hint">改动即时生效（自动保存），无需单独点保存。</div>`
    })}

    ${fold({
      id: 'card-proactive',
      icon: '💬',
      title: '主动开话题',
      sub: '冷场时按概率主动开话题',
      body: `
      <div class="checkbox-row"><input type="checkbox" id="cfg-proactive" ${c.proactive.enabled ? 'checked' : ''} />
        <label for="cfg-proactive">冷场时按概率主动开话题</label></div>
      <div class="field-row">
        <div class="field"><label>检查间隔下限（毫秒）</label><input type="number" id="cfg-pro-min" min="60000" value="${esc(c.proactive.checkIntervalMinMs)}" /></div>
        <div class="field"><label>检查间隔上限（毫秒）</label><input type="number" id="cfg-pro-max" min="120000" value="${esc(c.proactive.checkIntervalMaxMs)}" /></div>
        <div class="field"><label>触发概率 0~1</label><input type="number" id="cfg-pro-prob" step="0.05" min="0" max="1" value="${esc(c.proactive.probability)}" /></div>
      </div>`
    })}

    ${fold({
      id: 'card-sticker',
      icon: '😄',
      title: '表情包',
      sub: '收藏表情同步 / 发送积极度 / 提示词列举数',
      body: `
      <div class="checkbox-row"><input type="checkbox" id="cfg-sticker" ${c.sticker.enabled ? 'checked' : ''} />
        <label for="cfg-sticker">启用表情包（收藏表情同步 + 发送工具）</label></div>
      <div class="field">
        <label>发表情包的积极程度</label>
        <select id="cfg-sticker-encourage">
          ${STICKER_LEVELS.map(([v, label], i) =>
            `<option value="${v}" ${Number(c.sticker?.encourage ?? 1) === v ? 'selected' : ''}>${esc(label)}</option>`
          ).join('')}
        </select>
        <div class="hint">
          这是"引导"不是"强制"，模型仍会自行判断什么时机合适。
        </div>
      </div>
      <div class="field">
        <label>提示词里列举的表情包数量（1~50）</label>
        <input type="number" id="cfg-sticker-promptmax" min="1" max="50" value="${esc(Number(c.sticker?.promptMaxStickers) || 10)}" />
        <div class="hint">
          每次唤醒时，系统会把收藏表里最多这么多个表情包列进提示词供模型挑选。
          列得越多模型选择越丰富，但 token 成本也越高；收藏很多时适当调大，收藏少或想省 token 就调小。
        </div>
      </div>`
    })}

    <div class="field" style="margin-top:14px">
      <button class="btn" id="blocklist-btn" style="height:44px;padding:0 28px;font-size:14px">管理屏蔽名单</button>
    </div>`;
}

/**
 * 「个性化」区块：配色自定义 + 动效开关。
 *
 * 为什么颜色不在这个函数里写死，而是从 window.qqaColors 读：
 *   可自定义项清单（变量名/标签/说明/默认值）属于**运行时能力**，
 *   放在 shell/10-personalize.js 里离"应用覆盖值"的逻辑更近，
 *   也便于以后加项而不用改这个渲染函数。
 *   这里只负责把清单渲成 UI。
 *
 * 交互：
 *   · 每个色块点一下打开原生取色器（<input type=color>，最省事且用户熟悉）
 *   · "自定义"输入框接受任意 CSS 颜色（含 var(...) 与 rgba），满足高级用法
 *   · 单项"恢复默认" + 顶部"全部恢复" + "复制配色 CSS"（方便备份/分享）
 */
function renderPersonalizeSection(c) {
  const api = (typeof window !== 'undefined' && window.qqaColors) || null;
  const motionApi = (typeof window !== 'undefined' && window.qqaMotion) || null;

  // 运行时没加载时的兜底文案（例如单独打开某个测试页）
  if (!api) {
    return `
      <h3>个性化</h3>
      <p class="setsub">个性化模块未加载（shell/10-personalize.js）。</p>`;
  }

  const current = api.current();
  const groups = api.GROUPS || [];
  const changedCount = Object.keys(current).length;

  const rowHtml = (item) => {
    const cur = current[item.var] || '';
    // 三种格式**同时罗列**（用户要求：不要用小按钮切换，填哪个就补其他两个）。
    // 未自定义的项先按默认值解析出 HEX/RGB/HSL 显示，用户一看就知道现在是什么颜色。
    const fmt = (typeof window !== 'undefined' && window.qqaColorFormat) || null;
    const resolved = fmt ? fmt.all(cur || resolveTokenColor(item.var) || '') : null;
    const hexVal = resolved ? resolved.hex : (cur || '');
    const rgbVal = resolved ? resolved.rgb : '';
    const hslVal = resolved ? resolved.hsl : '';
    const pickerVal = resolved ? resolved.picker : '#888888';
    // 色块显示"当前实际颜色"：未自定义时用解析出来的默认色（否则是一块灰，
    // 用户看不到这一项到底影响什么颜色 —— 实测截图里整列都是灰的）。
    const dotColor = cur || (resolved ? resolved.picker : '');

    return `
      <div class="pz-row${cur ? ' pz-changed' : ''}" data-pz-var="${esc(item.var)}">
        <label class="pz-swatch" title="点击打开系统取色器">
          <input type="color" class="pz-picker" data-pz-var="${esc(item.var)}" value="${esc(pickerVal)}" />
          <span class="pz-dot" style="${dotColor ? `background:${esc(dotColor)}` : ''}" data-pz-dot="${esc(item.var)}"></span>
        </label>

        <div class="pz-text">
          <div class="pz-label">${esc(item.label)}${cur ? '<span class="pz-badge" title="已自定义">已改</span>' : ''}</div>
          <div class="pz-hint">${esc(item.hint)}</div>
          <div class="pz-var">${esc(item.var)}</div>
        </div>

        <!-- 三种格式全部摊开：任一框改动 → 自动补齐另外两个 -->
        <div class="pz-formats">
          <label class="pz-field">
            <span class="pz-tag">HEX</span>
            <input type="text" class="pz-input pz-in-hex" data-pz-fmt="hex" data-pz-var="${esc(item.var)}"
                   value="${esc(hexVal)}" spellcheck="false" placeholder="#rrggbb 或 #rrggbbaa" />
          </label>
          <label class="pz-field">
            <span class="pz-tag">RGB</span>
            <input type="text" class="pz-input pz-in-rgb" data-pz-fmt="rgb" data-pz-var="${esc(item.var)}"
                   value="${esc(rgbVal)}" spellcheck="false" placeholder="rgb(0, 0, 0)" />
          </label>
          <label class="pz-field">
            <span class="pz-tag">HSL</span>
            <input type="text" class="pz-input pz-in-hsl" data-pz-fmt="hsl" data-pz-var="${esc(item.var)}"
                   value="${esc(hslVal)}" spellcheck="false" placeholder="hsl(0, 0%, 0%)" />
          </label>
        </div>

        <button type="button" class="btn btn-small pz-reset" data-pz-reset="${esc(item.var)}"
                title="恢复该项默认">恢复</button>
      </div>`;
  };

  const motionOn = motionApi ? motionApi.getPref() === 'on' : true;
  const sysReduced = motionApi ? motionApi.systemReduced() : false;

  return `
    <h3>个性化</h3>
    <p class="setsub">
      这里的改动只影响本机外观，不改任何功能。配色直接覆盖界面用的 CSS 变量，
      深浅两套主题都会同步生效；想只改一套，可在输入框里填 <code>var(--s-)</code> 之外的具体颜色。
    </p>

    <div class="setcard fold open" id="card-motion">
      <div class="setcard-head fold-head">
        <div class="sc-ico">✨</div>
        <div class="sc-tt"><h4>动效</h4><div class="sc-sub">界面过渡、视图切换、主题扩散等动画的总开关</div></div>
        <span class="sc-val">${motionOn ? '已开启' : '已关闭'}</span>
        <span class="chev-r">›</span>
      </div>
      <div class="setcard-body fold-body"><div class="fold-inner">
        <div class="checkbox-row">
          <input type="checkbox" id="cfg-motion-on" ${motionOn ? 'checked' : ''} />
          <label for="cfg-motion-on">启用动效（关闭后所有动画与过渡立即停止）</label>
        </div>
        ${sysReduced ? '<div class="hint" style="color:var(--q-warn)">⚠️ 系统当前开启了「减弱动态效果」，即使这里打开也不会播放动画（无障碍设置优先）。</div>' : ''}
        <div class="hint">关闭动效不会影响功能，只是所有过渡变成瞬时切换。</div>
      </div></div>
    </div>

    <div class="setcard fold open" id="card-colors">
      <div class="setcard-head fold-head">
        <div class="sc-ico">🎨</div>
        <div class="sc-tt">
          <h4>配色</h4>
          <div class="sc-sub">选中态、启用的插件、出错/警告状态、背景与文字</div>
        </div>
        <span class="sc-val">${changedCount ? `已自定义 ${changedCount} 项` : '全部默认'}</span>
        <span class="chev-r">›</span>
      </div>
      <div class="setcard-body fold-body"><div class="fold-inner">
        <div class="pz-toolbar">
          <button type="button" class="btn btn-small" id="pz-reset-all" ${changedCount ? '' : 'disabled'}>全部恢复默认</button>
          <button type="button" class="btn btn-small" id="pz-copy-css" ${changedCount ? '' : 'disabled'}>复制配色 CSS</button>
          <span class="hint" id="pz-status"></span>
        </div>
        ${groups.map((g) => `
          <div class="pz-group">
            <div class="pz-group-title">${esc(g)}</div>
            ${(api.ITEMS || []).filter((it) => it.group === g).map(rowHtml).join('')}
          </div>`).join('')}
      </div></div>
    </div>`;
}

/** 把任意 CSS 颜色转成 <input type=color> 能接受的 #rrggbb。
 *  取色器只认 #rrggbb，而我们的默认值里有 var(--s-…)、#RRGGBBAA、rgba() 等形态。
 *  转不了就退回中性色 —— 取色器只是"快速挑一个"的入口，真正的值以输入框为准。 */
function toHexForPicker(value, varName) {
  const v = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase();      // 丢掉 alpha
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return ('#' + v.slice(1).split('').map((ch) => ch + ch).join('')).toLowerCase();
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (m) {
    const hex = (n) => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return '#888888';
}

/**
 * 读某个 CSS 变量在**当前主题**下的实际颜色（用于"未自定义时也显示三格式"）。
 * 做法：挂一个只用该变量的探针元素，读 computedStyle 的 color 再还原成 #rrggbb。
 * 为什么需要：默认值多数写成 `var(--s-ds-450)` 这种间接引用，
 * 直接把它塞进 HEX 输入框没有意义（用户看不懂、也无法编辑）——
 * 解析成真实颜色后，用户既看得懂"现在是什么色"，也能在此基础上微调。
 */
function resolveTokenColor(varName) {
  if (typeof document === 'undefined' || !varName) return '';
  try {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;left:-9999px;top:0;color:var(${varName})`;
    document.documentElement.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)\s*[,\s]+(\d+)/.exec(rgb);
    if (!m) return '';
    const hex = (n) => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  } catch { return ''; }
}

function renderDesktopSection(c) {
  return `
    <h3>桌面端</h3>
    <div class="checkbox-row"><input type="checkbox" id="cfg-autostart" ${c.server?.autoStart ? 'checked' : ''} />
      <label for="cfg-autostart">开机自启</label></div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-closetray" ${c.server?.closeToTray !== false ? 'checked' : ''} />
      <label for="cfg-closetray">点关闭时最小化到托盘</label></div>
    <h3>界面</h3>
    <div class="field"><label>主题</label>
      <div class="theme-picker" id="theme-picker">
        <!-- ⚠️ 2026-10-05 用户要求**去掉「跟随系统」**，只留亮/暗两档直接切换。
             这里原来列三档（auto/light/dark），理由是"顶栏按钮只是循环切换，
             用户需要一个回到自动档的入口" —— 那个理由成立的前提是"auto 是可选项"。
             现在两处都改成两档：顶栏按钮亮↔暗直接翻转，这里也是亮/暗二选一。
             auto 仍保留在 shell/00-theme.js 的解析逻辑里：
               老用户 localStorage 里可能留着它，启动时会被当成亮/暗正常渲染；
               THEME_LABEL/THEME_ICON 里也仍留着 auto 的条目，避免取不到时显示空。
             ⚠️ 这段注释在模板字符串里，不能出现反引号（会提前结束模板）。 -->
        ${['light', 'dark'].map((t) => `
          <div class="theme-option${getThemePref() === t ? ' on' : ''}" data-theme-opt="${t}" role="button" tabindex="0" title="固定为${THEME_LABEL[t] || t}">
            <span class="t-ico">${THEME_ICON[t] || ''}</span>
            <span>${THEME_LABEL[t] || t}</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-showvision" ${c.ui?.showVision !== false ? 'checked' : ''} />
      <label for="cfg-showvision">模型目录显示“支持图片输入/不支持图片输入”徽标</label></div>
    <div class="field"><label>界面刷新间隔（毫秒）</label><input type="number" id="cfg-refreshms" min="1000" step="1000" value="${esc(c.ui?.refreshMs ?? 15000)}" /></div>
    <h3>数据管理</h3>
    <div class="field"><label>用户数据目录</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="cfg-datadir" readonly value="${esc(state.dataDir || '（加载中…）')}" style="flex:1" />
        <button class="btn btn-small" id="open-datadir-btn">打开文件夹</button>
      </div>
      <div class="hint">所有用户数据（配置、聊天记录、记忆、表情包）都存在这个目录里。删除后重启应用即为初始形态。</div>
    </div>
    <div class="field">
      <button class="btn btn-danger" id="reset-data-btn">重置为初始形态</button>
      <span class="hint" id="reset-data-hint" style="margin-left:10px"></span>
      <div class="hint" style="margin-top:6px">⚠️ 此操作会删除所有用户数据（配置、聊天记录、记忆、表情包），不可恢复。建议先备份。</div>
    </div>
    <h3>版本更新</h3>
    <div class="field"><label>当前版本 <b id="update-current">…</b><span id="update-status-text">${(typeof updateAvailable !== 'undefined' && updateAvailable) ? '<b style="color:var(--orange)">；发现新版本</b>' : '；检查线上是否有新版本'}</span></label>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-small" id="check-update-btn">检查更新</button>
        <span class="hint" id="update-hint" style="margin:0"></span>
      </div></div>`;
}

function renderOnebotSection(c) {
  return `
    <h3 id="settings-onebot">OneBot（SnowLuma）</h3>

    <!-- ── SnowLuma 运行面板（2026-10-04 从独立页签整合进来）──────────────────
         整个「SnowLuma」页签的内容挂在这里：状态、启停、便携 QQ、运行日志、应用日志。
         实现方式是**复用**：容器 id 仍是 #snowluma-page，
         渲染与事件绑定仍由 03-snowluma.js 的 loadSnowlumaPage() 负责
         （它内部自己找 #snowluma-page 并 innerHTML + 绑事件），
         所以那边一行都不用改，只换挂载点。
         ⚠️ 容器必须**先存在于 DOM** 再调 loadSnowlumaPage()：
           见 renderSettings() 末尾的 afterRender 钩子。 -->
    <div id="snowluma-page" class="snowluma-pane snowluma-pane-embedded"></div>

    <h4 style="margin:18px 0 8px">连接配置</h4>
    <div class="field"><label>SnowLuma 程序目录（留空 = 自动使用项目内 snowluma/ 文件夹）</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="cfg-snowlumadir" value="${esc(c.snowluma.dir || '')}" style="flex:1" />
        <button class="btn btn-small" id="open-snowluma-btn">打开文件夹</button>
      </div>
      <div class="hint" id="snowluma-hint"></div></div>
    <div class="checkbox-row"><input type="checkbox" id="cfg-snowlumalaunch" ${c.snowluma.autoLaunch ? 'checked' : ''} />
      <label for="cfg-snowlumalaunch">QQ Agent 启动时自动拉起 SnowLuma（未运行时）</label></div>
    <div class="field-row">
      <div class="field"><label>WebSocket 地址（收消息）</label><input type="text" id="cfg-wsurl" value="${esc(c.snowluma.wsUrl)}" /></div>
      <div class="field"><label>HTTP 地址（发消息）</label><input type="text" id="cfg-httpurl" value="${esc(c.snowluma.httpUrl)}" /></div>
      <div class="field"><label>WebSocket 令牌</label>
        <div style="display:flex;gap:8px">
          <input type="password" id="cfg-obtoken" value="${esc(c.snowluma?.hasAccessToken ? '******' : '')}" placeholder="输入新令牌可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
          <button class="btn btn-small" id="cfg-obtoken-toggle" type="button">显示</button>
        </div></div>
      <div class="field"><label>HTTP 令牌（与 WS 不同时填；SnowLuma 默认分开）</label>
        <div style="display:flex;gap:8px">
          <input type="password" id="cfg-obhttptoken" value="${esc(c.snowluma?.hasHttpAccessToken ? '******' : '')}" placeholder="输入新令牌可替换；留空保持不变" autocomplete="new-password" style="flex:1" />
          <button class="btn btn-small" id="cfg-obhttptoken-toggle" type="button">显示</button>
        </div></div>
    </div>
    <div class="hint">改完 OneBot 地址需要重启应用生效；模型/人设/白名单即时生效。</div>`;
}

/**
 * 刷新 Skill 状态（后端判定结果）。
 * 单独抽出来是因为开关切换后需要立即重取，而不是等下一次 loadSettings。
 */
/**
 * 拉取技能/插件列表（内存态）。**不含磁盘重扫** —— 想让新放入的目录
 * 被看到，走 rescanSkills()。
 */
async function loadSkillsStatus() {
  try {
    const data = await api('/api/skills');
    state.skills = data.skills || [];
    state.skillsSummary = data.summary || {};
    state.uninstalledSkills = data.uninstalled || [];
  } catch {
    /* 取不到就保持原值，不覆盖成空列表造成"条目都不见了"的假象 */
  }
}

/**
 * 重扫磁盘并刷新列表：技能/插件页「刷新」按钮的完整动作。
 * 之前刷新只重读内存注册表，后台文件监听一旦丢事件（目录删除重建、
 * 网络盘、杀毒软件），放进去的新插件无论点多少次刷新都看不到。
 * 现在先 POST /api/skills/reload 让后端真正重扫；接口不可用时退回
 * 普通列表拉取（不比旧行为差）。
 */
async function rescanSkills({ quiet = false } = {}) {
  try {
    const r = await api('/api/skills/reload', { method: 'POST' });
    if (r && r.skills) {
      state.skills = r.skills;
      state.skillsSummary = r.summary || {};
      // 重扫接口的响应没有 uninstalled 字段，补拉一次（很轻，还能顺带拿脱敏配置）
      await loadSkillsStatus();
      if (!quiet && r.failed?.length) {
        console.warn('[skill] 本次重扫失败条目：', r.failed);
      }
      return r;
    }
  } catch (e) {
    console.warn('[skill] 重扫请求失败：', e?.message || e);
  }
  await loadSkillsStatus();
  return null;
}

/**
 * 技能设置弹窗。
 *
 * 为什么把设置放在技能自己的弹窗里（而不是塞进设置页）：
 *   · 这些字段**只对这个技能有意义** —— 分散在全局设置页里，用户根本对不上号
 *   · 技能页本来就该是"这个技能能配什么"的唯一入口
 *   · 开关和设置放在一起，改完立刻能看到状态徽章变化
 *
 * 表单**完全按 manifest 的 configSchema 渲染**，前端不硬编码任何字段名 ——
 * 加一个新技能、加一个字段，这里一行都不用改。
 * 支持的 type：boolean（复选框）/ number（数字输入）/ enum（下拉）/ string（文本框）
 * 另外 secret: true 的字段用密码框，且留空 = 不修改（后端也按同一约定处理）。
 */
/**
 * 生成技能设置弹窗的 HTML（**纯函数**，不碰 DOM）。
 *
 * 拆出来的唯一目的是可测：这次改动的重点是视觉层级
 * （名字用等宽大字、介绍用正文小字、模态框加宽），
 * 埋在 DOM 操作里就只能靠肉眼看，改坏了没人发现。
 *
 * @returns {{ html: string } | { error: string }}
 */
function renderSkillSettingsModal(skill) {
  if (!skill) return { error: '技能不存在' };
  const skillId = skill.id;
  const schema = skill.configSchema || {};
  const values = skill.settings || {};
  // internal 字段（列表/对象类）不渲染成表单输入 —— 它们由专用界面管理。
  // 但仍然要在弹窗里列出来并说明去哪改，否则用户会以为"这个设置根本不存在"。
  const allKeys = Object.keys(schema);
  const internalKeys = allKeys.filter((k) => schema[k]?.type === 'internal');
  const keys = allKeys.filter((k) => schema[k]?.type !== 'internal');
  if (!allKeys.length) return { error: '这个技能没有可配置项' };

  const fieldHtml = (key) => {
    const d = schema[key] || {};
    const v = values[key] ?? d.default ?? '';
    const label = esc(d.label || key);
    const hint = d.description ? `<div class="hint">${esc(d.description)}</div>` : '';
    const id = `skset-${esc(skillId)}-${esc(key)}`;
    // secret：用密码框 + 占位符提示"留空不改"，避免把脱敏值当明文回填
    const isSecret = d.secret === true;
    // 长文本字段跨整行：窄列里换行会碎成一条，读起来很累
    const isWide = d.type === 'string' && (d.multiline === true || String(d.description || '').length > 60);
    const cls = 'field' + (isWide ? ' field--wide' : '');
    let input;
    if (d.type === 'boolean') {
      // 整行做成可点区域：单摆一个小复选框在宽弹窗里像没渲染完
      input = `<label class="skill-toggle-row">
        <input type="checkbox" id="${id}" data-key="${esc(key)}" data-type="boolean" ${v ? 'checked' : ''} />
        <span class="st-text">${v ? '已开启' : '已关闭'}</span>
      </label>`;
    } else if (d.type === 'number') {
      input = `<input type="number" id="${id}" data-key="${esc(key)}" data-type="number" value="${esc(v)}" step="any" />`;
    } else if (d.type === 'enum' && Array.isArray(d.values)) {
      // 枚举渲染成下拉：值写错会让技能行为异常，下拉从根上避免手抖
      input = `<select id="${id}" data-key="${esc(key)}" data-type="enum">${
        d.values.map((x) => `<option value="${esc(x)}" ${String(v) === String(x) ? 'selected' : ''}>${esc(x)}</option>`).join('')
      }</select>`;
    } else {
      input = `<input type="${isSecret ? 'password' : 'text'}" id="${id}" data-key="${esc(key)}" data-type="string" value="${isSecret ? '' : esc(v)}" placeholder="${isSecret ? (v ? '已设置（留空 = 不修改）' : '未设置') : ''}" autocomplete="off" />`;
    }
    return `<div class="${cls}"><label>${label}${d.secret ? ' 🔒' : ''}</label>${input}${hint}</div>`;
  };

  return { html: `<div class="modal skill-modal" role="dialog" aria-modal="true" aria-label="${esc(skill.name)} 设置">
    <div class="skill-modal__head">
      <div class="skill-modal__titles">
        <div class="skill-modal__name">
          ${esc(skill.name)}
          <span class="skill-modal__ver">v${esc(skill.version || '')}</span>
        </div>
        <div class="skill-modal__id">${esc(skillId)}</div>
        <div class="skill-modal__desc">${esc(skill.description || '（这个技能没有写介绍）')}</div>
      </div>
      <button class="icon-btn" id="skset-x" title="关闭" aria-label="关闭">✕</button>
    </div>
    <div class="skill-modal__body">
      <div class="skill-modal__note">
        共 <b>${keys.length}</b> 项设置 · 保存在 <code>config.skills['${esc(skillId)}']</code>，只有这个技能会读到它们。
      </div>
      <div class="skill-form">${keys.map(fieldHtml).join('')}</div>
      ${internalKeys.length ? `<div class="skill-modal__internal">
        <div class="skill-modal__internal-head">以下设置不在这里改</div>
        ${internalKeys.map((k) => `<div class="skill-modal__internal-item"><b>${esc(schema[k].label || k)}</b><br />${esc(schema[k].description || '')}</div>`).join('')}
      </div>` : ''}
    </div>
    <div class="skill-modal__foot">
      <span class="skill-modal__foot-tip">改动即时生效，无需重启</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="skset-cancel">取消</button>
      <button class="btn btn-primary" id="skset-save">保存</button>
    </div>
  </div>` };
}

/** 打开某个技能的设置弹窗。 */
function openSkillSettings(skillId) {
  const skill = (state.skills || []).find((x) => x.id === skillId);
  if (!skill) return;
  const built = renderSkillSettingsModal(skill);
  if (built.error) { alert(built.error); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = built.html;
  document.body.appendChild(overlay);

  const close = () => closeAnimatedOverlay(overlay);
  overlay.querySelector('#skset-x').addEventListener('click', close);
  overlay.querySelector('#skset-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // Esc 关闭：弹窗大了以后鼠标要移很远，键盘出口是必需的
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();

  // 复选框旁边的"已开启/已关闭"文字要跟着变，否则看不出当前状态
  overlay.querySelectorAll('input[type="checkbox"][data-type="boolean"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const span = cb.parentElement?.querySelector('.st-text');
      if (span) span.textContent = cb.checked ? '已开启' : '已关闭';
    });
  });

  overlay.querySelector('#skset-save').addEventListener('click', async () => {
    const settings = {};
    overlay.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.dataset.key;
      const type = el.dataset.type;
      if (type === 'boolean') settings[key] = el.checked;
      else if (type === 'number') {
        const n = Number(el.value);
        // 空值/非数字：不提交这个键，让后端保留原值（而不是写进一个 NaN）
        if (el.value.trim() !== '' && Number.isFinite(n)) settings[key] = n;
      } else if (type === 'enum') settings[key] = el.value;
      else settings[key] = el.value;   // secret 留空 → 后端按"不修改"处理
    });
    try {
      const r = await api(`/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const idx = (state.skills || []).findIndex((x) => x.id === skillId);
      if (idx >= 0 && r.skill) {
        // 后端返回的是 status 视图；把设置与 schema 合并回去，避免卡片丢掉这两项
        state.skills[idx] = { ...state.skills[idx], ...r.skill, settings: r.settings || {}, configSchema: state.skills[idx].configSchema };
      }
      if (r.config) state.config = r.config;
      await loadSkillsStatus();
      // 两页都重绘：设置弹窗可能从技能页或插件页打开，
      // 而改动会同时影响状态徽章。重绘代价可忽略（每页最多十来张卡片）。
      renderModulePage('skill');
      renderModulePage('plugin');
      close();
    } catch (err) {
      alert(`保存失败：${err.message}`);
    }
  });
}

/**
 * 扩展页（技能 / 插件）
 *
 * 两型在**代码里完全同构**（同一条加载器、同一套清单字段、同一个开关），
 * 唯一的区别是"谁决定何时执行"：
 *   skill  （LLM 型）  —— 注册工具，模型看了 description 自己决定调不调
 *   plugin （确定性型）—— 提供能力/钩子，核心代码按能力名确定性调用，必然执行
 *
 * 这件事对使用者太重要了（决定"这个功能会不会被模型忽略"），所以拆成两个页签，
 * 但渲染逻辑共用一份 —— 否则两页的卡片、分组、开关行为迟早会分叉。
 *
 * ⚠️ 状态一律用后端 /api/skills 的判定结果，前端**不自己推断**能不能用 ——
 * 否则又会出现"界面说能用、实际不生效"的两套口径。
 */
const MODULE_KINDS = {
  skill: {
    kind: 'skill',
    tab: 'skills',
    boxSel: '#skills-page',
    title: '技能（Skill）',
    dir: 'skills/',
    emptyHint: `还没加载到任何技能。<br />LLM 型技能放在项目的 <code>skills/&lt;id&gt;/</code> 目录，需要 <code>skill.json</code> + <code>index.js</code>。`,
    lead: `技能是 <b>LLM 型</b>扩展：它们注册工具进模型的 function 列表，<b>用不用、什么时候用由模型自己判断</b>。<br />
      所以技能不会"一定生效" —— 模型可能一直不调用它。需要"条件满足必跑"的功能，应该做成插件（见旁边的「插件」页签）。`,
    setupTitle: '新增技能',
    setupHint: `在 <code>skills/&lt;id&gt;/</code> 放 <code>skill.json</code> + <code>index.js</code>，
      导出 <code>setup(api)</code> 并在里面 <code>api.registerTool({...})</code>。
      热重载默认开启，保存即生效。完整规范见 <code>doc/extend_development/skill-development.md</code>。`
  },
  plugin: {
    kind: 'plugin',
    tab: 'plugins',
    boxSel: '#plugins-page',
    title: '插件（Plugin）',
    dir: 'plugins/',
    emptyHint: `还没加载到任何插件。<br />确定性型插件放在项目的 <code>plugins/&lt;id&gt;/</code> 目录，需要 <code>plugin.json</code> + <code>index.js</code>。`,
    lead: `插件是 <b>确定性型</b>扩展：它们提供<b>能力</b>（<code>providers</code>）或<b>钩子</b>（<code>hooks</code>），
      由核心代码按能力名确定性调用 —— <b>条件满足就一定会执行，不经过 LLM，模型想忽略也忽略不掉</b>。<br />
      代价是它不能"看情况发挥"：什么时候触发必须在代码里写死。需要模型理解意图的功能，应该做成技能（见旁边的「技能」页签）。`,
    setupTitle: '新增插件',
    setupHint: `在 <code>plugins/&lt;id&gt;/</code> 放 <code>plugin.json</code> + <code>index.js</code>，
      导出 <code>setup(api)</code>，并用 <code>export const providers = {...}</code> 或 <code>export const hooks = {...}</code> 声明扩展点。
      热重载默认开启，保存即生效。完整规范见 <code>doc/extend_development/plugin-development.md</code>。`
  }
};

async function loadModulePage(kind, { rescan = false } = {}) {
  const meta = MODULE_KINDS[kind];
  if (!meta) return;
  const box = $(meta.boxSel);
  if (!box) return;
  box.innerHTML = renderModuleSkeleton(meta);
  if (rescan) await rescanSkills({ quiet: true });
  else await loadSkillsStatus();
  renderModulePage(kind);
  // 页面整页重建（切页签 / 手动刷新）时内容淡入；卡片开关后的原地重绘不播
  uiEnter(box);
}

function renderModuleSkeleton(meta) {
  return `<div class="usage-wrap">
    <div class="usage-head"><h2>${esc(meta.title)}</h2></div>
    <div class="sk-block">${'<div class="sk-row"></div>'.repeat(5)}</div>
  </div>`;
}

/**
 * 渲染一页（技能或插件）。
 *
 * @param {'skill'|'plugin'} kind 只渲染该类型；另一类的条目**完全不进这一页**
 */
function renderModulePage(kind) {
  const meta = MODULE_KINDS[kind];
  if (!meta) return '';
  const box = $(meta.boxSel);
  const all = state.skills || [];
  // 只留本页该管的类型。
  // ⚠️ kind 为 null（自定义根目录，如测试用的临时目录）时归入**技能页**而不是丢弃 ——
  // "界面上凭空少了一个条目"比"归错页"难排查得多（用户刚刚就踩过这个坑）。
  // 卡片上会标「目录未识别」提示作者去确认放置位置。
  const items = all.filter((s) => s.kind === meta.kind || (s.kind == null && meta.kind === 'skill'));

  // 统计按本页条目现算：后端 summary 是全量的，直接用会把另一类也算进来
  const mine = {
    total: items.length,
    active: items.filter((s) => s.active).length,
    off: items.filter((s) => s.loaded && !s.enabled).length,
    broken: items.filter((s) => !s.loaded).length
  };

  if (!items.length) {
    const emptyHtml = `<div class="usage-wrap">
      <div class="usage-head"><h2>${esc(meta.title)}</h2>
        <button class="btn btn-small" id="${esc(meta.tab)}-add-btn" title="从市场口令安装，或查看自建指南">＋ 添加${meta.kind === 'skill' ? '技能' : '插件'}</button>
        <div class="usage-days">
          <button class="btn btn-small" id="${esc(meta.tab)}-refresh-btn">刷新</button>
        </div></div>
      <div class="empty-hint">${meta.emptyHint}</div>
      <div class="hint" style="margin-top:10px">${meta.lead}</div>
    </div>`;
    if (box) box.innerHTML = emptyHtml;
    bindModulePageEvents(kind);
    return emptyHtml;
  }

  const catLabel = { model: '模型', message: '消息', knowledge: '知识', media: '媒体', utility: '工具' };

  // 按分类分组：一屏里按功能归类，比一长串平铺好找
  const order = ['model', 'message', 'media', 'knowledge', 'utility'];
  const byCat = new Map();
  for (const s of items) {
    const c = order.includes(s.category) ? s.category : 'utility';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(s);
  }

  // ── 卡片：单列一行，名称+简介常显，上传/设置钉在行尾 ──
  // 不再做正反面翻转（悬停才看简介）；按钮固定在内容框后侧，不随文字换行。
  const card = (s) => {
    const loadedOk = s.loaded;
    const active = loadedOk && s.enabled && s.active;
    const stateCls = !loadedOk ? 'mcard-broken' : (!s.enabled ? 'mcard-off' : (active ? 'mcard-on' : 'mcard-dep'));
    const stateTitle = !loadedOk ? `加载失败：${s.loadError || '原因未知'}`
      : (!s.enabled ? '已关闭（点击开启）'
        : (active ? '生效中（点击关闭）' : `已启用但依赖未就绪：${s.reason || (s.missingRequires || []).join('、') || '原因未知'}`));
    // 无法真正生效时，把原因写在卡片上（不再只藏在 title 提示里）
    let errLine = '';
    if (!loadedOk) {
      errLine = String(s.loadError || '加载失败，原因未知').slice(0, 160);
    } else if (s.enabled && !s.active) {
      errLine = String(s.reason || (s.missingRequires || []).map((r) => `缺少能力：${r}`).join('、') || '依赖未就绪').slice(0, 160);
    }
    const allFields = Object.keys(s.configSchema || {});
    const settingsBtn = allFields.length
      ? `<button class="mcard-gear" data-skill-id="${esc(s.id)}" title="设置（${allFields.length} 项）" aria-label="打开 ${esc(s.name)} 的设置">⚙</button>`
      : '';
    const uploadBtn = `<button class="mcard-upload" data-skill-id="${esc(s.id)}" data-skill-kind="${kind}" title="上传到市场" aria-label="上传 ${esc(s.name)} 到市场">⬆</button>`;
    const haystack = [s.id, s.name, s.description, s.dir].filter(Boolean).join(' ').toLowerCase();
    return `
    <div class="mcard ${stateCls}" data-skill-id="${esc(s.id)}" data-search="${esc(haystack)}" role="button" tabindex="0" title="${esc(stateTitle)}">
      <div class="mcard-main">
        <div class="mcard-name">${esc(s.name)} <span class="skill-card__ver">v${esc(s.version)}</span></div>
        ${(s.toolIds || []).length ? `<div class="mcard-tools" title="本技能注册的工具 id">${(s.toolIds || []).map((id) => `<code class="mcard-tool-id">${esc(id)}</code>`).join('')}</div>` : ''}
        <div class="mcard-desc">${esc(s.description || '（没有写介绍）')}</div>
        ${errLine ? `<div class="mcard-err">${esc(errLine)}</div>` : ''}
      </div>
      <div class="mcard-acts">${uploadBtn}${settingsBtn}</div>
    </div>`;
  };

  const sections = [...byCat.entries()].map(([cat, list]) => `
    <h3 class="usage-h3">${catLabel[cat] || cat}（${list.length}）</h3>
    <div class="module-grid">
      ${list.map(card).join('')}
    </div>
  `).join('');

  // 残留配置：只在技能页展示一次（两页共用 state）。
  const uninstalledHtml = (kind === 'skill' && (state.uninstalledSkills || []).length)
    ? `<h3 class="usage-h3">已配置但未安装（${state.uninstalledSkills.length}）</h3>
      <div class="hint" style="margin-bottom:6px">这些条目在配置里留着开关/设置，但 <code>skills/</code> 与 <code>plugins/</code> 目录里已经没有对应的文件夹。重装同名插件会自动恢复这些设置；确认不要了可以清理掉。</div>
      <div class="tool-meta" style="gap:6px;margin-bottom:8px">
        ${state.uninstalledSkills.map((u) => `<span class="tool-dep">${esc(u.id)}${u.enabled ? '' : '（已关）'}${u.hasSettings ? ' · 有设置' : ''}</span>`).join('')}
      </div>
      <button class="btn btn-small" id="skills-cleanup-btn">清理这些残留配置</button>`
    : '';

  const html = `<div class="usage-wrap">
      <div class="usage-head">
        <h2>${esc(meta.title)}</h2>
        <button class="btn btn-small" id="${esc(meta.tab)}-add-btn" title="从市场口令安装，或查看自建指南">＋ 添加${meta.kind === 'skill' ? '技能' : '插件'}</button>
        <input type="search" class="module-search" id="module-search-${esc(meta.tab)}"
          placeholder="搜索${meta.kind === 'skill' ? '技能' : '插件'}名称 / 简介…" autocomplete="off" />
        <div class="usage-days">
          <span class="uc-tag" title="生效中 / 这一页的总数">${mine.active} / ${mine.total} 生效</span>
          <button class="btn btn-small" id="${esc(meta.tab)}-refresh-btn">刷新</button>
        </div>
      </div>
      <div class="hint" style="margin-bottom:14px">
        ${meta.lead}<br />
        开关只有这一处 —— 关闭后它注册的工具、提供的能力、提示词片段和请求改写会**同时**失效。
        不可用时下面会直接写明原因（未启用 / 缺依赖 / 模型不支持 / 加载失败）。
      </div>
      ${sections}
      ${uninstalledHtml}
    </div>`;

  if (box) box.innerHTML = html;
  bindModulePageEvents(kind);
  if (typeof enhanceConcept2UI === 'function') enhanceConcept2UI(box);
  return html;
}

/** 供渲染测试按名取用的两个入口（render-test 会逐个执行这些函数）。 */
function renderSkillsPage() { return renderModulePage('skill'); }
function renderPluginsPage() { return renderModulePage('plugin'); }

function bindModulePageEvents(kind) {
  const meta = MODULE_KINDS[kind];
  if (!meta) return;
  // 「＋ 添加」入口（标题旁）：打开添加模态框（去市场口令安装 / 自建指南）。
  // ⚠️ 这个入口曾经从模板里消失过 —— openAddModuleModal 变成没人调用的孤本，
  // 技能/插件页直接失去"添加"能力。按钮与绑定必须成对存在（2026-09-26 修复）。
  $(`#${meta.tab}-add-btn`)?.addEventListener('click', () => openAddModuleModal(kind));
  $(`#${meta.tab}-refresh-btn`)?.addEventListener('click', () => loadModulePage(kind, { rescan: true }));
  // 残留配置清理（只在技能页渲染，按钮也只在这一页出现）
  $('#skills-cleanup-btn')?.addEventListener('click', async () => {
    const btn = $('#skills-cleanup-btn');
    if (!btn || !state.uninstalledSkills?.length) return;
    const ids = state.uninstalledSkills.map((u) => u.id);
    if (!(await uiConfirm(`清理 ${ids.length} 个未安装条目的配置（${ids.join('、')}）？\n清理后重装同名插件将恢复默认设置。`))) return;
    btn.disabled = true;
    try {
      const r = await api('/api/skills/cleanup', { method: 'POST', body: JSON.stringify({ ids }) });
      if (r.config) state.config = r.config;
      await loadModulePage('skill');
    } catch (e) {
      alert(`清理失败：${e?.message || e}`);
      btn.disabled = false;
    }
  });
  // 注意这里是 $$ （返回数组）不是 $（返回单个元素）：
  // 卡片可能有多个，用 $ 会拿到一个元素然后 .forEach 报错。
  // ⚠️ 绑定范围必须限定在**本页容器内**：两个页面同时存在于 DOM 里（只是 view 切换显隐），
  // 用全局 $$ 会把另一页的卡片也绑一遍 —— 同一个开关被绑两次，一次切换会发两个请求。
  const scope = $(meta.boxSel);
  if (!scope) return;
  scope.querySelectorAll('.skill-settings-btn, .mcard-gear').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();   // 齿轮在卡片内部，点它不能触发整卡开关
      openSkillSettings(btn.dataset.skillId);
    });
  });
  // 上传到市场（⬆ 钮）：同样 stopPropagation，且带上卡片所属类型
  scope.querySelectorAll('.mcard-upload').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMarketUploadModal(btn.dataset.skillKind || kind, btn.dataset.skillId);
    });
  });
  // ── 整卡即开关：点击卡片任意处切换启停（复用原 skill-toggle 的请求链）──
  // 键盘可达：Enter/Space 同样触发（role=button + tabindex=0）。
  scope.querySelectorAll('.mcard').forEach((cardEl) => {
    const toggle = async () => {
      const id = cardEl.dataset.skillId;
      const cur = (state.skills || []).find((s) => s.id === id);
      if (!cur || !cur.loaded) return;   // 加载失败的条目切不动
      const next = !cur.enabled;
      cardEl.style.pointerEvents = 'none';
      try {
        const r = await api(`/api/skills/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: JSON.stringify({ enabled: next })
        });
        const idx = (state.skills || []).findIndex((s) => s.id === id);
        if (idx >= 0 && r.skill) state.skills[idx] = r.skill;
        if (r.config) state.config = r.config;
        await loadSkillsStatus();
        renderModulePage(kind);
      } catch (err) {
        alert(`切换失败：${err.message}`);
        cardEl.style.pointerEvents = '';
      }
    };
    cardEl.addEventListener('click', toggle);
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // 顶部搜索：按卡片 data-search 本地过滤（不整页重绘，保留开关状态与滚动）
  const searchInput = scope.querySelector('.module-search');
  if (searchInput) {
    const applyFilter = () => {
      const q = searchInput.value.trim().toLowerCase();
      scope.querySelectorAll('.mcard').forEach((el) => {
        const hay = el.dataset.search || '';
        el.style.display = (!q || hay.includes(q)) ? '' : 'none';
      });
      // 分类标题：组内卡片被滤光则标题一并藏掉
      scope.querySelectorAll('.module-grid').forEach((grid) => {
        const any = [...grid.querySelectorAll('.mcard')].some((el) => el.style.display !== 'none');
        grid.style.display = any ? '' : 'none';
        const h = grid.previousElementSibling;
        if (h && h.classList.contains('usage-h3')) h.style.display = any ? '' : 'none';
      });
    };
    searchInput.addEventListener('input', applyFilter);
  }
}

/**
 * 「进阶」设置栏：给愿意折腾的选项一个归处。
 *
 * 第一个（也是目前唯一一个）开关是**人设共用**：
 *   打开 = 本账号的人设相关字段（角色设定 / 统一人设开关 / 分会话人设）一律取主账号（bot 号）的，
 *          在 bot 号改一次，本账号跟着变；
 *   关闭 = 本账号完全用自己的那一份（默认，行为与从前一致）。
 * 只对"非主账号"有意义 —— 主账号自己就是基准，打开等于没开。
 */
/** 账号联动表（同步渲染，数据来自 01-boot 已拉取的 state.accounts —— 不发请求，不会"读取中"）*/
function renderAdvancedAccountTable() {
  const list = (typeof state !== 'undefined' && Array.isArray(state.accounts)) ? state.accounts : [];
  if (!list.length) return '<div class="hint">（账号列表尚未加载：刷新页面后可见）</div>';
  return `<table class="model-rows-table">
    <tr><th>账号</th><th>QQ</th><th>OneBot 端口</th><th>连接</th><th>SnowLuma 配置</th></tr>
    ${list.map((a) => {
      const r = a.runtime || {};
      const ws = String(a.onebot?.ws || '').split(':').pop();
      const http = String(a.onebot?.http || '').split(':').pop();
      const st = r.connected === true ? '在线' : (r.running ? '离线' : '未接入');
      return `<tr>
        <td>${esc(a.label || a.uin)}${String(a.uin) === String((typeof state !== 'undefined' && state.active) || '') ? ' <span class="muted">(当前)</span>' : ''}</td>
        <td class="muted">${esc(a.uin)}</td>
        <td class="muted">ws ${esc(ws || '-')} / http ${esc(http || '-')}</td>
        <td>${st === '在线' ? '✅ 在线' : st}</td>
        <td>${a.hasSnowlumaConfig === false ? '<span class="muted">待建</span>' : '✅'}</td>
      </tr>`;
    }).join('')}
  </table>`;
}

function renderAdvancedSection(c) {
  const sc = (typeof setCard === 'function') ? setCard : (o) => `<div class="setcard">${o.body}</div>`;
  const shared = c.personaShared === true;
  const autoLaunch = c.snowluma?.autoLaunch === true;
  const hookAuto = c.snowluma?.hookAutoLoad === true;
  const snowDir = String(c.snowluma?.dir || '');
  return `
    <h3>进阶</h3>
    <div class="hint" style="margin-bottom:12px">偏底层/少用的开关放这里。改动即时生效（与其它设置一样自动保存）。</div>
    ${sc({
      id: 'card-advanced-autolaunch',
      icon: '🚀',
      title: '启动时自动拉起 SnowLuma',
      sub: 'QQ Agent 启动时，若 SnowLuma 没在运行就自动拉起它',
      body: `
      <div class="checkbox-row">
        <input type="checkbox" id="cfg-snowluma-autolaunch" ${autoLaunch ? 'checked' : ''} />
        <label for="cfg-snowluma-autolaunch">应用启动时自动拉起 SnowLuma（未运行时）</label>
      </div>
      <div class="hint" style="margin-top:8px">
        打开后：QQ Agent 启动即检查 SnowLuma，未运行就自动拉起（等价于手动点 SnowLuma 页签的「启动」）。
        当前状态：<b>${autoLaunch ? '自动' : '手动'}</b>${snowDir ? ` · 目录：<code>${esc(snowDir)}</code>` : ''}
      </div>`
    })}
    ${sc({
      id: 'card-advanced-hook',
      icon: '💉',
      title: '启动时自动注入 Hook 到 QQ',
      sub: 'SnowLuma 的 hookAutoLoad：QQ 启动后自动注入 Hook，无需手动点',
      body: `
      <div class="checkbox-row">
        <input type="checkbox" id="cfg-snowluma-hookautoload" ${hookAuto ? 'checked' : ''} />
        <label for="cfg-snowluma-hookautoload">启动 SnowLuma 时自动注入 Hook</label>
      </div>
      <div class="hint" style="margin-top:8px">
        勾选后会写入 <code>snowluma/config/runtime.json</code> 的 <code>hookAutoLoad</code>（写前自动备份该文件），
        <b>重启 SnowLuma 后生效</b>：之后 QQ 一启动就自动注入。<br>
        当前状态：<b>${hookAuto ? '已开启（启动即注入）' : '关闭（需手动注入）'}</b>
      </div>
      <div class="hint" style="margin-top:10px">
        <b>与账号联动</b>：下面是注册表里的账号（各自 OneBot 端口与 SnowLuma 配置）。登录哪个 QQ 由 SnowLuma 决定；
        这里保证 Hook 会自动注入，且每个号都有自己那一套端口与配置。
      </div>
      ${renderAdvancedAccountTable()}<div style="display:none">
      </div>`
    })}
    ${sc({
      id: 'card-advanced-persona',
      icon: '🧩',
      title: '人设库共用',
      sub: '本账号的"人设库"是否与主账号（bot 号）共用一份（各号仍各用自己的当前人设）',
      body: `
      <div class="checkbox-row">
        <input type="checkbox" id="cfg-persona-shared" ${shared ? 'checked' : ''} />
        <label for="cfg-persona-shared">与主账号共用同一份人设库（保存的人设互相可见/可选）</label>
      </div>
      <div class="hint" style="margin-top:8px">
        打开后：人设选择器里能选到<b>两边保存过的所有人设</b>；在这里新保存的人设也会进共享库。<br>
        <b>注意：这不会让两个号使用同一个人设</b> —— 每个号仍用自己的当前人设。
        当前状态：<b>${shared ? '共用中' : '各自独立'}</b>。
      </div>`
    })}`;
}

function renderToolsSection(c) {
  // 技能失活（未启用 / 加载失败 / 依赖未就绪）时，它注册的工具整组**不再显示** ——
  // 与提示词口径一致（orchestrator 的 getToolAvailability 过滤，失活技能的工具
  // 也不会写进提示词）。"界面看得到、模型用不到"和"界面看不到、提示词却写了"
  // 都是要消灭的割裂。
  const skillActive = new Map((state.skills || []).map((s) => [s.id, s.active === true]));
  const tools = (state.toolRegistry || []).filter((t) => !t.skillId || skillActive.get(t.skillId) === true);
  /**
   * ⚠️ `c`（= state.config）在**配置还没拉回来**时是 null。
   *
   * 这里是整个设置页里**唯一**直接解引用 `c.xxx` 的分区 —— 别的分区要么
   * 用 `c?.x`，要么在 `renderSettingsSection` 之前就假设配置已到。
   * 结果是：如果用户在配置到位之前点开「工具与技能」，这一分区会抛
   *   TypeError: Cannot read properties of null (reading 'tools')
   * 并被外层 try 捕获成"设置页渲染失败" —— 整块内容变成一行报错，
   * 直到刷新才好。这是个既有缺陷（与任何主题/皮肤改动无关），
   * 只是冷启动后立刻点设置时容易撞上。
   *
   * 用 `c || {}` 兜底：配置未到时按"全部默认开启"渲染一份，
   * 配置回来后下一次 renderSettings() 会自然修正，比整块报错好得多。
   */
  const toolsCfg = (c || {}).tools || {};
  // 分类清单必须与 tool-registry 的 CATEGORY_META 同源（8 类）：
  // 曾经只列 6 类，media/knowledge 两类的工具（send_image、bili-meme 等）
  // 在设置页无卡片 → 无分类开关也无单工具开关，只能手改 JSON。
  const categories = ['messaging', 'sticker', 'query', 'memory', 'web', 'knowledge', 'media', 'system'];
  const categoryNames = {
    messaging: '💬 消息发送',
    sticker: '😀 表情管理',
    query: '🔍 消息查询',
    memory: '🧠 记忆系统',
    web: '🌐 联网搜索',
    knowledge: '📚 知识库',
    media: '🎞️ 媒体理解',
    system: '⚙️ 系统反馈'
  };

  // 按分类分组
  const byCategory = {};
  for (const t of tools) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  // 渐进式披露：默认折叠，点击展开
  const expandedCategories = state.expandedToolCategories || new Set(['messaging']); // 默认展开第一个

  const categoryCards = categories.map((cat) => {
    const catTools = byCategory[cat] || [];
    if (!catTools.length) return '';
    const catEnabled = toolsCfg.categories?.[cat] !== false;
    const isExpanded = expandedCategories.has(cat);

    const toolCards = isExpanded ? catTools.map((t) => {
      const enabled = toolsCfg.overrides?.[t.id] ?? t.defaultEnabled ?? true;
      const disabledByDep = (t.requiresVision && c.api?.vision === false) || (t.requiresSearch && c.webSearch?.enabled === false);
      // 功能名字 + 一句话概括（description 可能缺失，不能直接 .split）
      const funcName = String(t.id || '').split(':').pop();
      const summary = String(t.description || '（无说明）').split('。')[0] + '。';
      // send_to 的开关就是「跨会话发送」本身（tools.crossChatSend）：
      // 开关收编进消息发送分类，用户在工具卡上直接控制，不再单独设全局勾选框。
      const isSendTo = t.id === 'send_to';
      const checked = isSendTo ? (toolsCfg.crossChatSend === true) : enabled;
      const chkId = `tool-chk-${t.id.replace(/[^\w-]/g, '_')}`;
      return `
        <div class="tool-card ${checked ? 'enabled' : 'disabled'} ${disabledByDep ? 'dep-disabled' : ''}" data-tool-id="${t.id}">
          <div class="tool-header">
            <label class="switch tool-switch">
              <input type="checkbox" class="tool-checkbox" id="${chkId}" data-tool-id="${t.id}" ${isSendTo ? 'data-cross-chat="1"' : ''} ${checked ? 'checked' : ''} ${disabledByDep && !isSendTo ? 'disabled' : ''} />
              <span class="track"><span class="thumb"></span></span>
            </label>
            <span class="tool-icon">${t.icon}</span>
            <div class="tool-title">
              <div class="tool-name">${esc(funcName)}${t.skillId ? '<span class="tool-dep tool-skill">skill</span>' : ''}</div>
              <div class="tool-summary">${esc(summary)}</div>
            </div>
          </div>
          <div class="tool-meta">
            ${t.requiresVision ? '<span class="tool-dep">需要视觉模型</span>' : ''}
            ${t.requiresSearch ? '<span class="tool-dep">需要搜索服务</span>' : ''}
            ${disabledByDep ? '<span class="tool-dep-warn">依赖未满足</span>' : ''}
            ${isSendTo ? '<span class="tool-dep">目标须在白名单内</span>' : ''}
          </div>
        </div>`;
    }).join('') : '';

    return `
      <div class="tool-category ${isExpanded ? 'expanded' : 'collapsed'}" data-category="${cat}">
        <div class="tool-category-header" data-category="${cat}" role="button" tabindex="0">
          <span class="tool-category-arrow">${isExpanded ? '▼' : '▶'}</span>
          <span class="tool-category-name">${categoryNames[cat] || cat}</span>
          <label class="tool-category-toggle switch" onclick="event.stopPropagation()">
            <input type="checkbox" class="category-checkbox" data-category="${cat}" ${catEnabled ? 'checked' : ''} />
            <span class="track"><span class="thumb"></span></span>
          </label>
          <span class="tool-category-count">${catTools.length} 个工具</span>
        </div>
        ${isExpanded ? `<div class="tool-list">${toolCards}</div>` : ''}
      </div>`;
  }).join('');

  // ⚠️ 必须落在顶层 setCard 里：renderSettingsSection 直接嵌这一段时，
  // autoFoldSettings 会按 h3 把整页重包成折叠卡，再把 .fold-head 绑到
  // 分类头上 —— 点分类会开合整块面板，grid-rows 折叠把下半屏撑出大片空白。
  const fold = (typeof setCard === 'function') ? setCard : (o) => `<div class="setcard">${o.body}</div>`;
  return `
    <h3 id="settings-tools">工具与技能</h3>
    <div class="hint" style="margin-bottom:12px">
      打开开关启用机器人可调用的工具。关闭后模型将无法使用该功能。
      ${toolsCfg.enabled === false ? '<span style="color:var(--red)">⚠️ 全局开关已关闭，所有工具均不可用</span>' : ''}
    </div>
    ${fold({
      id: 'card-tools-list',
      icon: '🛠',
      title: '工具列表',
      sub: '按分类展开；开关即时保存',
      open: true,
      body: `
        <div class="checkbox-row">
          ${switchHtml('cfg-tools-enabled', toolsCfg.enabled !== false, '启用工具系统（关闭后机器人只能看不能做任何操作）')}
        </div>
        <div class="tool-actions" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-small" id="tools-enable-all">全部启用</button>
          <button class="btn btn-small" id="tools-disable-all">全部禁用</button>
          <button class="btn btn-small" id="tools-reset">恢复默认</button>
        </div>
        ${categoryCards || '<div class="hint">（还没有注册任何工具）</div>'}`
    })}`;
}

/**
 * 完整提示词预览文本（设置-工具与技能 & 技能页右侧共用同一份）。
 * 数据来自 GET /api/prompt-preview —— 后端用运行时同一套
 * buildSystemPrompt + getToolAvailability 组装，按当前启停状态实时反映；
 * 前端不再自己拼（曾经前端复制了一份静态模板，永远是"全启用"的样子，
 * 与实际发送的提示词越漂越远）。
 * 后端返回结果缓存在 state.promptPreview；render* 渲染时同步取，
 * 开关变动后由 refreshPromptPreview() 异步拉新并原地更新 DOM。
 */
function renderPromptPreviewText() {
  const d = state.promptPreview;
  if (!d || typeof d.systemPrompt !== 'string') return '（正在加载提示词预览…）';
  const tools = d.tools || [];
  const toolLines = tools.length
    ? tools.map((t) => `- ${t.id}：${t.description}`).join('\n')
    : '（当前没有可用工具）';
  return `${d.systemPrompt}\n\n【本次可用工具清单（function calling）】\n${toolLines}`;
}

/**
 * 拉取/刷新提示词预览。
 * 实时性设计（2026-09-17）：预览读的是**后端活配置**（getConfig），而设置的
 * 自动保存有 600ms 防抖 —— 直接刷看到的是旧状态。所以本函数可带 overrides
 * （与配置同结构的临时补丁）：请求发给 /api/prompt-preview，后端先深合并补丁
 * 再组装（不落盘），预览即刻反映刚点的开关，不用等自动保存落地。
 */
async function refreshPromptPreview(overrides = null) {
  try {
    // 空对象不附 body（GET 语义）——没有补丁就按后端活配置组装
    const hasOverrides = overrides && Object.keys(overrides).length > 0;
    const d = await api('/api/prompt-preview', hasOverrides ? {
      method: 'POST',
      body: JSON.stringify(overrides)
    } : {});
    state.promptPreview = d;
  } catch {
    state.promptPreview = null;
  }
  // 两处预览 DOM（设置-工具页 / 技能页右侧）都原地换文本，不整页重渲染
  $$('.prompt-preview-content').forEach((pre) => {
    pre.textContent = renderPromptPreviewText();
  });
}
