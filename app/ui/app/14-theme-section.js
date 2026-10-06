// ═══════════════════════════════════════════════════════════════════════════
// 14-theme-section.js — 设置页「主题」卡页
// ═══════════════════════════════════════════════════════════════════════════
// 用户要求："个性化中单独加一个卡页：主题"。
//
// 页面结构（两级）：
//   ① 顶层：皮肤卡片（默认 / Minecraft）
//   ② 二级：Minecraft 被选中时，出现「Minecraft 主题设置」卡片
//      —— 音效 / 背景 / 字体。**只有 MC 有二级**，默认皮肤没有（它没这些东西可调）。
//      这正是需求里"音效可在 Minecraft 主题，也就是当前选择主题的二级设置下进行音量调整"
//      所指的位置。
//
// 为什么皮肤卡片用"大预览块"而不是下拉框：
//   主题是**视觉选择**，用户需要看到长什么样才能决定。下拉框只给名字，
//   等于让用户盲选。预览块用该皮肤自己的配色画一个小界面示意 ——
//   切换前就能看出区别（见 3x-theme.css 的 .th-skin-preview）。
'use strict';

/* global state, esc */

/** 取皮肤运行时（shell/01-skin.js）。没加载时返回 null，由调用方兜底。 */
function themeSkinApi() {
  return (typeof window !== 'undefined' && window.qqaSkin) || null;
}

/**
 * 主题卡页。
 * 注意：这个函数只**渲染 HTML**，事件绑定在 07-settings-events.js 里
 * （与「个性化」区块同一约定 —— 渲染与接线分开，重渲染不会重复绑事件）。
 */
function renderThemeSection(c) {
  const skinApi = themeSkinApi();
  const themeApi = (typeof window !== 'undefined' && window.qqaThemePref) || null;
  const curSkin = skinApi ? skinApi.getPref() : 'default';
  const curPref = (typeof getThemePref === 'function') ? getThemePref() : 'auto';
  const actual = (typeof document !== 'undefined')
    ? (document.documentElement.getAttribute('data-theme') || 'light') : 'light';

  if (!skinApi) {
    return `
      <h3>主题</h3>
      <p class="setsub">主题模块未加载（shell/01-skin.js）。</p>`;
  }

  const SKIN_ORDER = ['default', 'minecraft'];
  /**
   * 亮度档：**只有亮色 / 暗色两档**。
   *
   * ⚠️ 2026-10-05 用户明确要求去掉"跟随系统"：
   *    "亮暗联动不是要改成跟随系统，而是直接亮色和暗色切换"。
   *    原来这里是三档（跟随系统/亮色/暗色），与标题栏按钮的三档循环一致；
   *    现在两处都改成**两档直接切换**，语义与"亮暗开关"对齐。
   *    老用户 localStorage 里可能还留着 'auto' —— 下面 THEME_LABEL 仍保留它的
   *    文案，只是不再是可选项，于是它会被当作"亮色"呈现，点一下就固定下来。
   */
  const THEME_ORDER = ['light', 'dark'];
  const THEME_LABEL = { auto: '跟随系统', light: '亮色', dark: '暗色' };
  /** 偏好在界面上的呈现：auto 归到亮/暗里显示，但选中态只在两档之间 */
  const shownPref = THEME_ORDER.includes(curPref) ? curPref : (actual === 'dark' ? 'dark' : 'light');

  // ── 皮肤卡片 ──────────────────────────────────────────────────────────
  const skinCard = (id) => {
    const m = skinApi.META[id];
    const on = id === curSkin;
    return `
      <button type="button" class="th-skin${on ? ' is-on' : ''}" data-skin="${esc(id)}"
              role="radio" aria-checked="${on ? 'true' : 'false'}"
              title="切换到「${esc(m.name)}」皮肤">
        <span class="th-skin-preview th-prev-${esc(id)}" aria-hidden="true">
          ${skinPreview(id)}
        </span>
        <span class="th-skin-text">
          <span class="th-skin-name">${esc(m.name)}${on ? '<span class="th-badge">使用中</span>' : ''}</span>
          <span class="th-skin-desc">${esc(m.desc)}</span>
        </span>
      </button>`;
  };

  // ── 亮度卡片 ──────────────────────────────────────────────────────────
  // ⚠️ 亮度是**每套皮肤各自解析**的（见 01-skin.js 顶部说明）：
  //    "Minecraft 的暗色" ≠ "暗色主题"。所以这里只切换 data-theme，
  //    具体长什么样由各皮肤的 CSS 决定。
  const themeRow = `
    <div class="th-modes" role="radiogroup" aria-label="亮度">
      ${THEME_ORDER.map((v) => `
        <button type="button" class="th-mode${v === shownPref ? ' is-on' : ''}" data-theme-pref="${esc(v)}"
                role="radio" aria-checked="${v === shownPref ? 'true' : 'false'}"
                title="切换到${esc(THEME_LABEL[v])}">${esc(THEME_LABEL[v])}</button>`).join('')}
    </div>`;

  // ── 二级设置：只有 Minecraft 有 ────────────────────────────────────────
  const subCard = skinApi.META[curSkin] && skinApi.META[curSkin].hasSub
    ? renderMinecraftSubSettings()
    : '';

  return `
    <h3>主题</h3>
    <p class="setsub">
      这里决定整套界面的外观。主题改动只影响本机，不改任何功能。
    </p>

    <div class="setcard fold open" id="card-skin">
      <div class="setcard-head fold-head">
        <div class="sc-ico">🎨</div>
        <div class="sc-tt"><h4>皮肤</h4><div class="sc-sub">换一套完整的界面风格（配色 / 图标 / 字体 / 背景 / 音效）</div></div>
        <span class="sc-val">${esc(skinApi.META[curSkin] ? skinApi.META[curSkin].name : curSkin)}</span>
        <span class="chev-r">›</span>
      </div>
      <div class="setcard-body fold-body"><div class="fold-inner">
        <div class="th-skins" role="radiogroup" aria-label="皮肤">
          ${SKIN_ORDER.map(skinCard).join('')}
        </div>
      </div></div>
    </div>

    <div class="setcard fold open" id="card-brightness">
      <div class="setcard-head fold-head">
        <div class="sc-ico">◐</div>
        <div class="sc-tt"><h4>亮度</h4><div class="sc-sub">亮色 / 暗色 / 跟随系统。每套皮肤各自解析这套配色</div></div>
        <span class="sc-val">${esc(THEME_LABEL[curPref] || curPref)}${curPref === 'auto' ? `（当前${actual === 'dark' ? '暗色' : '亮色'}）` : ''}</span>
        <span class="chev-r">›</span>
      </div>
      <div class="setcard-body fold-body"><div class="fold-inner">
        ${themeRow}
        <p class="th-note">
          标题栏右上角那颗按钮与这里是**同一个开关** —— 在任何一边切换，另一边会同步。
          Minecraft 皮肤有自己独立的一套亮暗配色 —— 选它之后这两个档位换的是 <b>MC 风格的亮/暗</b>，
          不是默认皮肤那套。
        </p>
      </div></div>
    </div>

    ${subCard}
    ${renderWineFoxSettings()}
  `;
}

/** A local companion shared by both skins, with no backend configuration write. */
function renderWineFoxSettings() {
  const api=window.qqaWineFox;
  const p=api?api.read():{enabled:false,size:280,paused:false,animation:'idle',expression:-1};
  const s=api?api.state():{loaded:false,loading:false,error:''};
  const animations=s.animations||['idle'];
  const expressions=['自动（跟随动作）','普通','开心','生气','紧张','惊讶','小张嘴','呆住'];
  return `<div class="setcard fold open" id="card-wine-fox">
    <div class="setcard-head fold-head"><div class="sc-ico">🦊</div>
      <div class="sc-tt"><h4>酒狐互动宠物</h4><div class="sc-sub">拖动移动，轻点打招呼，连续轻点会生气</div></div>
      <span class="sc-val" data-wine-fox-summary>${p.enabled?'开启':'关闭'}</span><span class="chev-r">›</span></div>
    <div class="setcard-body fold-body"><div class="fold-inner">
      <div class="wine-fox-options">
        <label class="switch"><input type="checkbox" data-wine-fox-pref="enabled" ${p.enabled?'checked':''}><span class="track"><span class="thumb"></span></span><span>开启酒狐</span></label>
        <label class="switch"><input type="checkbox" data-wine-fox-pref="paused" ${p.paused?'checked':''}><span class="track"><span class="thumb"></span></span><span>暂停动作</span></label>
        <label>大小 <select data-wine-fox-pref="size">${[160,220,280,340,400].map(n=>`<option value="${n}" ${p.size===n?'selected':''}>${n}px</option>`).join('')}</select></label>
        <button type="button" class="btn" data-wine-fox-home>位置复位</button>
      </div>
      <div class="wine-fox-options" style="margin-top:12px">
        <label>动作 <select data-wine-fox-pref="animation" ${s.loaded?'':'disabled'}>${animations.map(n=>`<option value="${esc(n)}" ${p.animation===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
        <label>表情 <select data-wine-fox-pref="expression">${expressions.map((name,i)=>`<option value="${i-1}" ${p.expression===i-1?'selected':''}>${name}</option>`).join('')}</select></label>
      </div>
      <p class="th-note" data-wine-fox-status role="status">${esc(s.error||(s.loading?'酒狐正在过来…':p.enabled?'已开启':'已关闭'))}</p>
      <p class="th-note">默认与 Minecraft 皮肤均可使用。宠物设置仅保存在本机。</p>
    </div></div></div>`;
}

/**
 * 皮肤缩略预览（纯 CSS 画的小界面示意图）。
 * 为什么要画而不是截真图：截图会随主题/字体变化而失真，
 * 而且每加一套皮肤就要维护一份图片。纯 CSS 的示意块永远和当前配色同步。
 */
function skinPreview(id) {
  if (id === 'minecraft') {
    // 像素风示意：方块边框 + 草绿/泥土棕，与 MC 皮肤的真实配色同源
    return `
      <span class="th-pv-row th-pv-top"></span>
      <span class="th-pv-body">
        <span class="th-pv-side">
          <b class="th-pv-blk"></b><b class="th-pv-blk"></b><b class="th-pv-blk th-pv-on"></b><b class="th-pv-blk"></b>
        </span>
        <span class="th-pv-main">
          <b class="th-pv-card"></b><b class="th-pv-card"></b>
        </span>
      </span>`;
  }
  // 默认皮肤示意：扁平圆角
  return `
    <span class="th-pv-row th-pv-top"></span>
    <span class="th-pv-body">
      <span class="th-pv-side">
        <b class="th-pv-bar"></b><b class="th-pv-bar"></b><b class="th-pv-bar th-pv-on"></b><b class="th-pv-bar"></b>
      </span>
      <span class="th-pv-main">
        <b class="th-pv-card"></b><b class="th-pv-card"></b>
      </span>
    </span>`;
}

/**
 * 「Minecraft 主题设置」二级卡片。
 *
 * 需求对应（用户原话）：
 *   · "音效可在…二级设置下进行音量调整，音效整体开关"
 *   · "点击按钮/信息卡时默认使用 Minecraft 的菜单按钮的音效"
 *   · "开关功能采用拉杆…活塞推出/收回的音效（每种音效用户在二级菜单内自行选择）"
 *   · "滑条默认不开启（使用）音效，但是用户可以选择…（音符盒，拉杆，木质/石质按钮开关，活塞推出/收回）"
 *   · "UI 的背景采用任意 Minecraft 的无水印极高清截图…默认要有 3-5 张…透明度…可自行调整"
 *   · "中文和英文字体均更改成 Minecraft 中的风格…并将其打包至主题内"
 *
 * 分段的实际含义：本轮（第 1 段）先把**卡页结构与存储**立起来，
 *  音效/背景/字体的具体实现在后续段落填入（各自的实现文件见注释）。
 *  所以这里先渲染出分组与控件，值从 localStorage 读、写由事件层负责。
 */
function renderMinecraftSubSettings() {
  const st = (typeof window !== 'undefined' && window.qqaMcTheme && window.qqaMcTheme.read)
    ? window.qqaMcTheme.read()
    : { sfxOn: true, sfxVolume: 0.6, bgOn: true, bgOpacity: 0.35, bgIndex: 0, sliderSfx: 'off', fontOn: true };
  // 用途 → 候选项，从运行时统一取。运行时没加载时给一份保守兜底，
  // 保证设置页在缺少模块的环境里仍能渲染（而不是抛错白屏）。
  // ⚠️ 兜底要与运行时保持一致 —— 第一版忘了同步，删掉木/石按钮后
  //    兜底里还留着 wood/stone，两边就会画出不同的下拉框。
  const USES = (typeof window !== 'undefined' && window.qqaMcTheme && window.qqaMcTheme.SFX_USES)
    ? window.qqaMcTheme.SFX_USES
    : { click: ['menu', 'note', 'pop', 'hit', 'bow'],
        toggle: ['lever', 'piston', 'beacon'],
        slider: ['off', 'note', 'pop', 'hit', 'bow', 'lever', 'piston'] };

  const pct = Math.round((Number(st.sfxVolume) || 0) * 100);
  const bgPct = Math.round((Number(st.bgOpacity) || 0) * 100);

  return `
    <div class="setcard fold open" id="card-mc">
      <div class="setcard-head fold-head">
        <div class="sc-ico">⛏</div>
        <div class="sc-tt"><h4>Minecraft 主题设置</h4><div class="sc-sub">音效 · 背景（这套设置只在 Minecraft 皮肤下生效）</div></div>
        <span class="sc-val">Minecraft</span>
        <span class="chev-r">›</span>
      </div>
      <div class="setcard-body fold-body"><div class="fold-inner">

        <!-- ── 音效 ─────────────────────────────────────────────────── -->
        <div class="pz-group th-sub">
          <div class="pz-group-title">互动音效</div>

          <div class="checkbox-row">
            <input type="checkbox" id="mc-sfx-on" data-mc="sfxOn" ${st.sfxOn ? 'checked' : ''} />
            <label for="mc-sfx-on">启用互动音效（总开关）</label>
          </div>

          <div class="th-field">
            <label class="th-field-label" for="mc-sfx-volume">音量</label>
            <input type="range" id="mc-sfx-volume" data-mc="sfxVolume" min="0" max="100" step="1"
                   value="${pct}" class="th-range" />
            <span class="th-field-val" data-mc-out="sfxVolume">${pct}%</span>
          </div>

          <!-- 点击音：默认 MC 菜单按钮音（需求明确"默认使用 Minecraft 的菜单按钮的音效"）
               ⚠️ 选项来自运行时按**用途**给出的 SFX_USES.click ——
                  用户划了边界："用于开关的不用于按钮和点击"。 -->
          <div class="th-field">
            <label class="th-field-label" for="mc-sfx-click">点击音<small>按钮 / 信息卡</small></label>
            <select id="mc-sfx-click" data-mc="clickSfx" class="th-select">
              ${sfxOptions(st.clickSfx, USES.click, false)}
            </select>
          </div>

          <!-- 开关音：需求"开关功能采用拉杆…活塞推出/收回的音效（每种音效用户在二级菜单内自行选择）"
               注意活塞与信标是**有方向**的：开启用"推出/激活"，关闭用"收回/关闭"（用户要求）。 -->
          <div class="th-field">
            <label class="th-field-label" for="mc-sfx-toggle">开关音<small>拉杆 / 复选框；活塞与信标区分开与关</small></label>
            <select id="mc-sfx-toggle" data-mc="toggleSfx" class="th-select">
              ${sfxOptions(st.toggleSfx, USES.toggle, false)}
            </select>
          </div>

          <!-- 滑条音：需求"滑条默认不开启（使用）音效" → 默认 off -->
          <div class="th-field">
            <label class="th-field-label" for="mc-sfx-slider">滑条音<small>默认关闭</small></label>
            <select id="mc-sfx-slider" data-mc="sliderSfx" class="th-select">
              ${sfxOptions(st.sliderSfx, USES.slider, true, 'off')}
            </select>
          </div>
        </div>

        <!-- ── 背景 ─────────────────────────────────────────────────── -->
        <div class="pz-group th-sub">
          <div class="pz-group-title">背景图</div>

          <div class="checkbox-row">
            <input type="checkbox" id="mc-bg-on" data-mc="bgOn" ${st.bgOn ? 'checked' : ''} />
            <label for="mc-bg-on">显示背景图</label>
          </div>

          <div class="th-field">
            <label class="th-field-label" for="mc-bg-opacity">透明度<small>越低越不影响读字</small></label>
            <input type="range" id="mc-bg-opacity" data-mc="bgOpacity" min="0" max="100" step="1"
                   value="${bgPct}" class="th-range" />
            <span class="th-field-val" data-mc-out="bgOpacity">${bgPct}%</span>
          </div>

          <div class="th-field th-field-block">
            <span class="th-field-label">选择背景</span>
            <div class="th-bgs" id="mc-bg-list" role="radiogroup" aria-label="背景图">
              ${renderBgChoices(st.bgIndex)}
            </div>
          </div>
        </div>

        <!-- ⚠️ 原来这里还有一个"字体"分组（一个开关 + 说明）。2026-10-05 用户要求删掉：
             "最下方的字体相关内容删掉"。
             字体现在跟随皮肤自动生效（Minecraft 皮肤用 MC 字体，默认皮肤用原字体），
             不需要单独一个开关 —— 皮肤本身就决定了字体，
             多一个开关只会让人不确定"关掉之后会变成什么样"。
             fontOn 偏好键仍保留在运行时（DEFAULTS 里），
             因为它是 data-mc-font 属性的来源、也避免老配置读取时缺键。
             ⚠️ 这个注释在模板字符串里，不能出现反引号（会提前结束模板）。 -->


      </div></div>
    </div>`;
}


/**
 * 音效下拉项。
 *
 * @param cur     当前值
 * @param list    候选项（音效名）—— 由运行时按**用途**给出，见 SFX_USES
 * @param allowOff 是否允许"不播放"
 * @param offDefault 回落值
 *
 * ⚠️ 选项列表不再写死在这一层，而是从 `window.qqaMcTheme.SFX_USES` 取。
 *    原因：用户明确划了用途边界 ——「用于开关的不用于按钮和点击」。
 *    这个边界是**数据**（哪个音效属于哪类），写死在三个 if 分支里
 *    改一次要改三处，而且很容易漏掉一处导致两边都能选到同一个音效。
 */
function sfxOptions(cur, list, allowOff, offDefault) {
  const api = (typeof window !== 'undefined' && window.qqaMcTheme) || null;
  const NAME = {};
  if (api) for (const [k, v] of Object.entries(api.SFX)) NAME[k] = v.label;
  NAME.off = '不播放';
  const items = (list || []).slice();
  if (allowOff && !items.includes('off')) items.push('off');
  // 未知值回落：宁可显示默认项，也不要出现一个空的下拉框
  const val = items.includes(cur) ? cur : (offDefault && items.includes(offDefault) ? offDefault : items[0]);
  return items.map((v) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(NAME[v] || v)}</option>`).join('');
}

/**
 * 「主题」卡页的事件接线。
 *
 * ⚠️ 三个易错点，都写在这里免得以后踩：
 *   1. **皮肤切换必须重渲染设置页**：皮肤决定预览块的配色、也决定"有没有 Minecraft
 *      二级卡片"。只改属性不重渲染，用户会看到"点了但二级设置没出现"。
 *      重渲染要在 set() **之后**调用（set 里已经改了 data-skin）。
 *   2. **亮度切换走 applyTheme，不走自己实现**：那里面有"跳过空转档"、
 *      扩散动效、后端同步等一整套踩过坑的逻辑（见 shell/00-theme.js）。
 *      这里重复实现一遍必然漏掉其中某条。
 *   3. **二级设置的控件要即时反馈**：range/select 改动立刻写 localStorage +
 *      更新界面，不走设置页的"防抖保存"（那是给后端 config 用的，
 *      这些偏好只存本地，没有保存按钮也不该有延迟感）。
 */
function bindThemeSectionEvents() {
  const skinApi = themeSkinApi();
  const mc = (typeof window !== 'undefined' && window.qqaMcTheme) || null;

  // ── 皮肤卡片 ──────────────────────────────────────────────────────────
  document.querySelectorAll('#settings-form .th-skin[data-skin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!skinApi) return;
      const id = btn.dataset.skin;
      if (id === skinApi.getPref()) return;          // 点已选中的，不做无意义重渲染
      skinApi.set(id);
      // 音效：皮肤切换本身也走"菜单按钮"音（MC 里点任何按钮都响）
      if (mc && typeof mc.play === 'function') mc.play('menu');
      renderSettings();
    });
  });

  // ── 亮度档 ────────────────────────────────────────────────────────────
  document.querySelectorAll('#settings-form .th-mode[data-theme-pref]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.themePref;
      if (typeof applyTheme !== 'function') return;
      // 以按钮为扩散原点：与标题栏主题按钮的行为一致（用户已习惯这个动效）
      applyTheme(v, btn);
      renderSettings();
    });
  });

  if (!mc) return;   // 没有 MC 运行时就到此为止（默认皮肤不需要下面这些）

  // ── Minecraft 二级设置 ────────────────────────────────────────────────
  const reRenderIfSkinChanged = () => { /* 二级设置改动不需要整页重渲染 */ };
  void reRenderIfSkinChanged;

  /** 把当前偏好刷到界面上（不重渲染整页，避免打断正在拖的滑条）。 */
  function syncOutputs(prefs) {
    document.querySelectorAll('#settings-form [data-mc-out]').forEach((el) => {
      const k = el.dataset.mcOut;
      if (k === 'sfxVolume' || k === 'bgOpacity') el.textContent = `${Math.round((Number(prefs[k]) || 0) * 100)}%`;
    });
    document.querySelectorAll('#settings-form [data-bg-index]').forEach((el) => {
      const on = Number(el.dataset.bgIndex) === Number(prefs.bgIndex);
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // 复选框（音效总开关 / 背景开关 / 字体）
  document.querySelectorAll('#settings-form [data-mc]').forEach((el) => {
    const key = el.dataset.mc;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.addEventListener('change', () => {
        const prefs = mc.write({ [key]: el.checked });
        // 开关类交互的音效：按**方向**取（活塞开=推出、关=收回；信标同理）。
        // 关掉音效总开关时不响 —— 那一下再响会让人以为没关掉。
        if (key !== 'sfxOn' || el.checked) {
          if (typeof mc.play === 'function') mc.play(prefs.toggleSfx, el.checked ? 'on' : 'off');
        }
        syncOutputs(prefs);
      });
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => {
        const prefs = mc.write({ [key]: el.value });
        // 选完立刻试听：用户改了音效却听不到，等于没法选。
        // 开关类用 'on' 方向试听（能听到"开启"那一半）；滑条类用无方向播放。
        if (typeof mc.play === 'function') {
          mc.play(el.value === 'off' ? 'menu' : el.value, key === 'toggleSfx' ? 'on' : null);
        }
        void prefs;
      });
    } else if (el.tagName === 'INPUT' && el.type === 'range') {
      // 拖动过程只更新读数（写盘放到 change），否则一秒几十次 localStorage 写入
      el.addEventListener('input', () => {
        const out = document.querySelector(`#settings-form [data-mc-out="${key}"]`);
        if (out) out.textContent = `${el.value}%`;
      });
      el.addEventListener('change', () => {
        // 音量键存 0..1，透明度键也存 0..1（界面上是 0..100）
        const v = Math.max(0, Math.min(100, Number(el.value) || 0)) / 100;
        const prefs = mc.write({ [key]: v });
        syncOutputs(prefs);
        // 音量滑条试听点击音；透明度滑条用**滑条音**（默认 off 即不响）
        if (key === 'sfxVolume') {
          if (typeof mc.play === 'function') mc.play(prefs.clickSfx);
        } else if (typeof mc.play === 'function') {
          mc.play(prefs.sliderSfx);
        }
      });
    }
  });

  // 背景缩略图
  document.querySelectorAll('#settings-form [data-bg-index]').forEach((el) => {
    el.addEventListener('click', () => {
      const prefs = mc.write({ bgIndex: Number(el.dataset.bgIndex) });
      if (typeof mc.play === 'function') mc.play('menu');
      syncOutputs(prefs);
    });
  });

}

/**
 * 全局滑条音（第 5 段）。
 *
 * 需求原话："滑条默认不开启（使用）音效，但是用户可以选择以下音效
 *            （音符盒，拉杆，木质/石质按钮开关，活塞推出/收回）"。
 *
 * 所以这里**挂在所有 range 上**，而不只是主题页那两个：
 *   界面上还有"档位参数"等滑条（设置页 / 个性化页），用户选了滑条音
 *   就是希望所有滑条都响。按类音效（`sliderSfx`）统一播放。
 *
 * 触发时机取 **change**（松手）而不是 input（拖动中）：
 *   拖动时每个像素都响会变成噪音（MC 里滑条也不是连续出声的）。
 *   但为了有"手感"，拖动过程中按节流播一次 —— 人的操作习惯是
 *   "拖 → 停下看看 → 再拖"，每次停顿给一声就够了。
 */
function mcSfxForSlider(v) {
  if (v === 'off') return;
  const mc = (typeof window !== 'undefined' && window.qqaMcTheme) || null;
  if (!mc || typeof mc.play !== 'function') return;
  if (document.documentElement.getAttribute('data-skin') !== 'minecraft') return;
  mc.play(v);
}

/** 绑定全站滑条音效。只绑一次（用标记防重复）。 */
function bindGlobalSliderSfx() {
  if (window.__mcSliderBound) return;
  window.__mcSliderBound = true;
  let lastAt = 0;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('input[type="range"]')) return;
    const mc = (typeof window !== 'undefined' && window.qqaMcTheme) || null;
    if (!mc) return;
    // 拖动节流：至少间隔 180ms 才出一声，避免连续噪音
    const now = Date.now();
    if (now - lastAt < 180) return;
    lastAt = now;
    mcSfxForSlider(mc.read().sliderSfx);
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindGlobalSliderSfx, { once: true });
else bindGlobalSliderSfx();

/**
 * 让「主题」卡页跟随**别处**的主题变化（标题栏那颗按钮、系统明暗自动切换）。
 *
 * 问题（用户报告）：标题栏右上角的亮/暗按钮切了，主题页里的亮度档位不跟着变 ——
 *   因为标题栏按钮只调 `applyTheme()`（它内部 commitTheme 只刷新标题栏那颗按钮的图标），
 *   而主题页的 `.th-mode.is-on` 与卡头摘要是在 `renderThemeSection()` 里算的，
 *   没有任何人通知它重渲染。两处状态就各自为政了。
 *
 * 做法：监听 `qqa-theme-change` 事件（commitTheme 每次都会派发），
 *   若当前正停在主题页且**渲染用的偏好已经过期**，就重渲染一次。
 *
 * ⚠️ 必须带"已过期"判断，不能无脑重渲染：
 *   renderSettings() 会重新拉取 config/skills 等一堆接口，
 *   而 applyTheme 在系统明暗切换、启动、甚至我们自己点亮度档时都会派发这个事件 ——
 *   无脑重渲染会造成"点一下亮度档 → 重渲染 → 事件 → 再重渲染"的连锁与闪烁。
 *   判断依据：卡头摘要里记录的偏好 vs 当前实际偏好，不一致才动。
 */
function bindThemeChangeSync() {
  if (window.__mcThemeSyncBound) return;
  window.__mcThemeSyncBound = true;
  window.addEventListener('qqa-theme-change', () => {
    if (typeof state === 'undefined' || state.tab !== 'settings') return;
    if ((state.settingsSection || 'api') !== 'theme') return;
    const root = document.querySelector('#card-brightness .sc-val');
    if (!root) return;                       // 主题页没渲染，不用管
    const shown = (root.textContent || '').trim();
    const pref = (typeof getThemePref === 'function') ? getThemePref() : 'auto';
    const actual = document.documentElement.getAttribute('data-theme') || 'light';
    const LABEL = { auto: '跟随系统', light: '亮色', dark: '暗色' };
    const want = `${LABEL[pref] || pref}${pref === 'auto' ? `（当前${actual === 'dark' ? '暗色' : '亮色'}）` : ''}`;
    if (shown === want) return;              // 已经是最新，不重渲染
    if (typeof renderSettings === 'function') renderSettings();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindThemeChangeSync, { once: true });
else bindThemeChangeSync();

/**
 * 背景选择项。
 * 背景清单来自运行时（window.qqaMcTheme.BACKGROUNDS），这样加图只改一处。
 */
function renderBgChoices(cur) {
  const api = (typeof window !== 'undefined' && window.qqaMcTheme) || null;
  const list = (api && api.BACKGROUNDS) || [];
  if (!list.length) {
    return '<span class="th-note">背景素材尚未打包（见第 6 段）。</span>';
  }
  return list.map((bg, i) => `
    <button type="button" class="th-bg${i === cur ? ' is-on' : ''}" data-bg-index="${i}"
            role="radio" aria-checked="${i === cur ? 'true' : 'false'}" title="${esc(bg.name || ('背景 ' + (i + 1)))}">
      <img src="${esc(bg.thumb || bg.url)}" alt="${esc(bg.name || '')}" loading="lazy" />
    </button>`).join('');
}
