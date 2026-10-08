// ═══════════════════════════════════════════════════════════════════════════
// 02-mc-theme.js — Minecraft 皮肤的偏好与运行时（音效 / 背景 / 字体）
// ═══════════════════════════════════════════════════════════════════════════
// 分段说明：本文件是第 1 段建立的**存储与读取层**。
//   后续段落往这里加"真正干活"的部分（播放音效、切换背景、加载字体），
//   但**偏好键名与默认值在这里一次性定死** —— 免得后面每加一项就改一遍设置页。
//
// 键名与默认值（默认值来自用户需求的原话，逐条对应）：
//   sfxOn        true     "音效整体开关"
//   sfxVolume    0.6      "进行音量调整"（0..1；界面上是 0..100%）
//   clickSfx     'menu'   "点击按钮/信息卡时**默认**使用 Minecraft 的菜单按钮的音效"
//   toggleSfx    'lever'  "开关功能采用拉杆""活塞推出/收回的音效（每种音效…自行选择）"
//   sliderSfx    'off'    "滑条**默认不开启**（使用）音效"
//   bgOn         true     "UI 的背景采用任意 Minecraft 的…截图"
//   bgOpacity    0.35     "透明度默认要保持各种信息均可保持较好的鉴别程度"
//   bgIndex      0        "默认要有 3-5 张"（默认选第一张）
//   fontOn       true     "中英文均更改成 Minecraft 中的风格"
'use strict';

(function mcThemeRuntime() {
  const KEY = 'qqa-mc';

  /** 默认值 = 需求原话。改这里等于改"开箱体验"。 */
  const DEFAULTS = {
    sfxOn: true,
    sfxVolume: 0.6,
    clickVolume: 1, toggleVolume: 1, sliderVolume: 1,
    clickSfx: 'menu',
    toggleSfx: 'lever',
    sliderSfx: 'off',
    bgOn: true,
    bgOpacity: 0.35,
    bgIndex: 0,
    fontOn: true
  };

  /**
   * 透明度为什么默认 0.35：
   *   需求是"透明度默认要保持各种信息均可保持较好的鉴别程度"。
   *   0.35 时背景图能看清是张游戏截图，同时正文/数字的对比度仍远高于 WCAG AA
   *   要求的 4.5:1（默认皮肤的正文已经是深色字 + 浅底，背景只是叠了一层 35% 的图）。
   *   上限锁 0.6：再高就会明显吃掉文字对比度，那时用户自己调高即可，
   *   不该由默认值替他做这个牺牲。
   */
  const BG_OPACITY_MAX = 1;

  /**
   * 背景素材清单。
   * 由 tools/gen-mc-bg.mjs 生成（1920×1080，像素画 384×216 最近邻放大 5 倍）。
   * thumb 是 160×90 的小图，只在设置页的选择列表里用 ——
   * 列表里放 5 张 1920×1080 会让打开设置页时多拉 500KB。
   */
  const BACKGROUNDS = [

    {url:'/assets/mc/bg/wallpaper-1.png',thumb:'/assets/mc/bg/wallpaper-1.png'},
    {url:'/assets/mc/bg/wallpaper-2.png',thumb:'/assets/mc/bg/wallpaper-2.png'},
    {url:'/assets/mc/bg/wallpaper-3.png',thumb:'/assets/mc/bg/wallpaper-3.png'}
  ];

  /**
   * 音效清单（2026-10-05 第三轮清理后的最终形态）。
   *
   * 全部是**用户提供的原版素材**（E:\QQ Agent Dev\UI）。
   * 之前那批**合成**音效已全部退役：
   *   · `menu`  ← 用户指定改用 UI\Click.wav（原来是合成的木腔敲击）
   *   · `lever` → 用户要求"拉杆也是，改成菜单按钮"，于是开关音默认也走 menu；
   *   · `note`  → 用户要求删掉、不打包；
   *   · `pistonSynth` → 有用户提供的真活塞音（pistonin/out），合成版多余。
   * 对应的 wav 已从 assets 删除，gen-mc-sfx.mjs 里它们的配方也一并删掉 ——
   * "文件不打包"若只删文件、留着配方，看代码的人会以为它们还在用（本轮踩过这个）。
   *
   * `files` 是**数组**：一个"音效名"可以由多个文件组成（`hit` 就是 hit1/2/3，
   * 命名上视为一个整体小组、播放时随机挑一个）。
   * `on` / `off` 是**方向变体**：开关类音效在"打开"和"关闭"时应当不同 ——
   * 用户要求"开启时对应活塞推出，关闭对应活塞收回"，信标同理。
   */
  const SFX = {
    /* 菜单按钮音 = 用户提供的 Click.wav。点击与开关的默认项都指向它。 */
    menu: { files: ['menu.wav'], label: '菜单按钮' },
    // 活塞：开关用途。分方向 —— 开=推出，关=收回。
    piston: { files: ['pistonout.wav'], on: 'pistonout.wav', off: 'pistonin.wav', label: '活塞推出 / 收回' },
    // 信标：开关用途，分方向（开=激活 / 关=关闭）。
    beacon: { files: ['beaconactivate.wav'], on: 'beaconactivate.wav', off: 'beacondeactivate.wav', label: '信标激活 / 关闭' },
    hit: { files: ['hit1.wav', 'hit2.wav', 'hit3.wav'], label: '击打（三种随机）' },
    bow: { files: ['bow.wav'], label: '弓箭' },
    pop: { files: ['pop.wav'], label: '拾取物品' }
  };

  /**
   * 三个用途各自的候选项（顺序即下拉里的顺序，第一项是默认）。
   * ⚠️ 三条列表**互不重叠**（用户要求："用于开关的不用于按钮和点击"）。
   *    滑条是例外：它既不算"按钮和点击"也不算"开关"，所以自成一类。
   */
  const SFX_USES = {
    /** 点击按钮 / 信息卡。默认菜单按钮音（用户要求）。 */
    click: ['menu', 'pop', 'hit', 'bow'],
    /** 开关。默认也是菜单按钮音（用户要求"拉杆…改成菜单按钮"）。 */
    toggle: ['menu', 'piston', 'beacon'],
    /** 滑条。默认不播放（用户要求）。 */
    slider: ['off', 'menu', 'pop', 'hit', 'bow', 'piston']
  };

  /**
   * 已退役的音效名 → 现在的等价项。
   *
   * 为什么需要：偏好存在 localStorage 里，老用户的 `clickSfx` 可能是
   * `note` / `lever` / `wood` / `stone` / `pistonSynth` —— 这些名字现在都不存在了。
   * 不迁移的话设置页会渲染出一个**空下拉框**（值不在选项里），
   * 用户看不到当前选的是什么、一旦改动还等于被迫重选。
   * 统一映射到 `menu`（它们当年的听感定位都是"通用点击/开关音"）。
   */
  const SFX_RETIRED = {
    note: 'menu', lever: 'menu', wood: 'menu', stone: 'menu', pistonSynth: 'menu'
  };

  function read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* 损坏就按默认 */ }
    const out = Object.assign({}, DEFAULTS);
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(DEFAULTS)) {
        if (raw[k] === undefined || raw[k] === null) continue;
        // 类型对齐：布尔键只认布尔，数值键夹到合法区间，字符串键要求非空
        if (typeof DEFAULTS[k] === 'boolean') out[k] = !!raw[k];
        else if (typeof DEFAULTS[k] === 'number') {
          const n = Number(raw[k]);
          if (Number.isFinite(n)) out[k] = n;
        } else if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
      }
    }
    // 夹取：音量 0..1、透明度 0..上限、背景序号 0..清单长度-1
    for(const key of ['sfxVolume','clickVolume','toggleVolume','sliderVolume'])out[key]=Math.min(1,Math.max(0,out[key]));
    out.bgOpacity = Math.min(BG_OPACITY_MAX, Math.max(0, out.bgOpacity));
    const maxBg = Math.max(1, BACKGROUNDS.length) - 1;
    out.bgIndex = Math.min(maxBg, Math.max(0, Math.round(out.bgIndex)));
    // 音效名的合法化，两步：
    //   ① 已退役的名字（note/lever/wood/stone/pistonSynth）→ 映射到 menu。
    //      不映射的话下面第 ② 步只会把它换成"该类默认值"，虽然结果一样，
    //      但语义丢了 —— 显式迁移能让"老配置被升级过"这件事可追溯。
    //   ② 仍非法的 → 回落到该类默认值，避免设置页出现空下拉框。
    // 注意滑块音允许 'off'，所以要单独放行。
    for (const k of ['clickSfx', 'toggleSfx', 'sliderSfx']) {
      if (out[k] === 'off') continue;
      if (SFX_RETIRED[out[k]]) out[k] = SFX_RETIRED[out[k]];
      if (!SFX[out[k]]) out[k] = DEFAULTS[k];
    }
    return out;
  }

  function write(patch) {
    const next = Object.assign(read(), patch || {});
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 隐私模式 */ }
    applyToDocument(next);
    try {
      window.dispatchEvent(new CustomEvent('qqa-mc-change', { detail: { prefs: next } }));
    } catch { /* 老环境 */ }
    return next;
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    const next = read();
    applyToDocument(next);
    return next;
  }

  /**
   * 把偏好写到 CSS 变量上，让**样式层**决定长什么样。
   * 为什么不直接用 JS 设 element.style：背景/透明度是纯表现，
   * 交给 CSS 才能跟着 `data-skin` 一起被启用/禁用（见 3x-theme.css）。
   */
  function applyToDocument(prefs) {
    const p = prefs || read();
    const root = document.documentElement;
    try {
      root.style.setProperty('--mc-bg-opacity', String(p.bgOpacity));
      root.style.setProperty('--mc-sfx-volume', String(p.sfxVolume));
      root.setAttribute('data-mc-sfx', p.sfxOn ? 'on' : 'off');
      root.setAttribute('data-mc-bg', p.bgOn ? 'on' : 'off');
      root.setAttribute('data-mc-font', p.fontOn ? 'on' : 'off');
      if (BACKGROUNDS.length) {
        const bg = BACKGROUNDS[Math.min(BACKGROUNDS.length - 1, Math.max(0, p.bgIndex))] || BACKGROUNDS[0];
        root.style.setProperty('--mc-bg-image', `url("${bg.url}")`);
      } else {
        root.style.removeProperty('--mc-bg-image');
      }
    } catch { /* 老环境 */ }
  }

  /**
   * 把默认值落盘一次（仅当本地还没有这份记录时）。
   *
   * 为什么必须做：所有写入都走 write()，而 write() 只在**用户改动**时被调用。
   * 于是一个"从没动过任何 Minecraft 设置"的用户在切换皮肤后，
   * localStorage 里根本没有 qqa-mc —— 看起来偏好"没被保留"。
   * 更实际的影响：以后要迁移/清理这份配置时，无法区分
   * "用户用的是默认值" 和 "用户从没用过 MC 皮肤"。
   * 一次性落盘把这两件事分开，代价是一个几十字节的键。
   */
  function ensurePersisted() {
    try {
      if (localStorage.getItem(KEY) === null) {
        localStorage.setItem(KEY, JSON.stringify(read()));
      }
    } catch { /* 隐私模式：拿不到持久化也不影响本次会话 */ }
  }

  ensurePersisted();
  applyToDocument(read());

  // ── 互动音效（第 4 段）───────────────────────────────────────────────────
  //
  // 用 WebAudio 而不是 <audio> 标签，三个原因：
  //   1. **延迟**。UI 音效要在 30ms 内出声。<audio> 的 play() 在首次之后仍有
  //      调度开销，而 AudioBufferSourceNode 是合成线程直接启动，实测 <10ms。
  //   2. **可叠加**。连点按钮时 <audio> 会互相打断（同一个元素 seek 回 0），
  //      快速点击听起来会"断续"。WebAudio 每次 start() 是独立节点，天然叠加。
  //   3. **音量**。GainNode 一次设置全局生效；<audio> 要逐个元素设 volume。
  //
  // 音频数据用 fetch + decodeAudioData 预载，而不是每次点击都 decode：
  // decodeAudioData 是异步的重活（一个 100ms 音效约 0.5ms，但首次有冷启动），
  // 放在点击路径上就会有明显延迟。启动后一次性解码成 AudioBuffer 缓存起来。
  let audioCtx = null;
  const buffers = new Map();
  let wantLoad = false;

  function ctx() {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    } catch { audioCtx = null; }
    return audioCtx;
  }

  function sfxUrl(file) {
    // 与 index.html 同级的静态资源路径（assets 由 dev-server / 线上 app.js 一起伺服）
    return `/assets/mc/sfx/${file}`;
  }

  /**
   * 某个音效名在**当前方向**下应当用哪个（或哪几个）文件。
   * @param dir 'on' | 'off' | null —— 开关类的方向；点击/滑条传 null
   *
   * 方向变体的规则：`on`/`off` 存在就用对应的那一个文件；否则用 `files` 全部
   * （`files` 多于一个时由 play 随机挑 —— 见 hit 小组）。
   */
  function filesFor(name, dir) {
    const spec = SFX[name];
    if (!spec) return [];
    if (dir === 'on' && spec.on) return [spec.on];
    if (dir === 'off' && spec.off) return [spec.off];
    return spec.files || [];
  }

  /** 全部需要预载的文件（去重） */
  function allFiles() {
    const set = new Set();
    for (const spec of Object.values(SFX)) {
      for (const f of spec.files || []) set.add(f);
      if (spec.on) set.add(spec.on);
      if (spec.off) set.add(spec.off);
    }
    return [...set];
  }

  /**
   * 预载全部音效。皮肤切到 Minecraft 时调用（默认皮肤下不浪费这些请求）。
   * 缓存键是**文件名**（不是音效名）—— 因为一个音效名可能对应多个文件。
   */
  async function loadSfx() {
    const c = ctx();
    if (!c) return 0;
    let n = 0;
    for (const file of allFiles()) {
      if (buffers.has(file)) continue;
      try {
        const res = await fetch(sfxUrl(file));
        if (!res.ok) continue;
        const ab = await res.arrayBuffer();
        const buf = await c.decodeAudioData(ab);
        buffers.set(file, buf);
        n += 1;
      } catch { /* 单个音效缺失不该影响其它音效，也不该打断界面 */ }
    }
    return n;
  }

  /** 随机挑一个。`hit` 小组（hit1/2/3）就是靠这个"听起来像同一个音效有多种变化"。 */
  function pick(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * 播放一个音效。
   *
   * @param name 音效名（见 SFX 的键）
   * @param dir  'on' | 'off' | null —— 开关类传方向，让活塞/信标在开与关时发不同声音。
   *             非开关用途（点击/滑条）传 null 或不传。
   * @returns true 表示"确实发出了声音"（调用方可用它做验证）
   *
   * ⚠️ 浏览器自动播放策略：AudioContext 创建时是 `suspended`，必须由**用户手势**
   *    触发 resume()。所以这里在每次 play 前尝试 resume —— 第一次点击会顺带解锁，
   *    之后的点击就正常了。这是为何不返回 false 装作没这回事：
   *    解锁失败是真实状态，调用方（和测试）需要能看出来。
   */
  function play(name, dir, channel = dir ? 'toggle' : 'click') {
    if (!name || name === 'off') return false;
    const prefs = read();
    if (!prefs.sfxOn) return false;
    const c = ctx();
    if (!c) return false;
    const file = pick(filesFor(name, dir));
    if (!file) return false;
    const buf = buffers.get(file);
    if (!buf) {
      // 还没载到就先补载，本次静默（下一次点击就能响）
      if (!wantLoad) { wantLoad = true; loadSfx().finally(() => { wantLoad = false; }); }
      return false;
    }
    try {
      if (c.state === 'suspended') c.resume().catch(() => {});
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = Math.max(0, Math.min(1, prefs.sfxVolume * (prefs[channel+'Volume'] ?? 1)));
      src.connect(g);
      g.connect(c.destination);
      src.start();
      return true;
    } catch { return false; }
  }

  // ── 全局点击音（需求："点击按钮/信息卡时默认使用 Minecraft 的菜单按钮的音效"）──
  //
  // 用**事件委托挂在 document 上**，而不是给每个按钮单独绑：
  //   界面上的按钮是动态渲染的（设置页每次重渲染都换一批 DOM、仪表盘卡片同理），
  //   逐个绑必然漏掉后来出现的元素，而且重渲染后会重复绑定。
  //   委托一次，覆盖现在与将来所有的按钮。
  //
  // 判定"这是不是一个可点的按钮/卡片"：closest 匹配按钮类元素，且不在禁用态。
  //   注意要排除 range/checkbox —— 它们有自己的音效（滑条音 / 开关音），
  //   否则拖一下滑条会同时响"点击音 + 滑条音"两声。
  const CLICKABLE = 'button, .btn, .dash-box, .tab, .settings-menu-item, .market-card, .mem-item, .session-item, .chat-item, .th-skin, .th-mode, .th-bg';
  function onGlobalClick(e) {
    if (document.documentElement.getAttribute('data-skin') !== 'minecraft') return;
    const t = e.target;
    if (!t || !t.closest) return;
    // 滑条 / 复选框 / 下拉 / 文本输入：交给各自的音效，不叠加点击音
    if (t.closest('#q-winctl, [data-qwin], #card-colors[data-colors-disabled="true"] .setcard-body, #q-side-toggle, [data-persona-left="templates"], .switch, input[type="range"], input[type="checkbox"], select, input[type="text"], textarea')) return;
    const el = t.closest(CLICKABLE);
    if (!el) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    play(read().clickSfx);
  }
  document.addEventListener('click', onGlobalClick, true);   // capture: 先于业务处理，手感更"即时"

  /**
   * 开关类交互的音效（复选框/自定义开关/拉杆）。
   *
   * @param on 开关**变成了什么状态**。这个参数是必须的，不能再省 ——
   *   用户明确要求"开启时对应活塞推出，关闭对应活塞收回"，信标同理
   *   （激活 / 关闭）。所以"开关音"不是"一个固定的声音"，
   *   而是"一对有方向的声音"。省掉方向就只能发出同一个声音，
   *   活塞与信标这两种音效也就失去意义了。
   */
  function playToggle(on) {
    if (document.documentElement.getAttribute('data-skin') !== 'minecraft') return false;
    return play(read().toggleSfx, on ? 'on' : 'off');
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    // 用 change 之后的 checked 值当方向：change 触发时状态已经更新
    if (t.matches('input[type="checkbox"]')) playToggle(!!t.checked);
  }, true);

  /**
   * 折叠卡（页面卡）开合也要有声音。
   *
   * 用户要求："开关页面卡的时候也应该发出响应的点击声。"
   *
   * 为什么原来没有：全局点击音是按 `CLICKABLE` 白名单匹配的，
   * 而折叠卡的头 `.setcard-head` / `.sc-tt` 都不在名单里 ——
   * 它虽然 `cursor:pointer` 且整行可点，却发不出声，手感很"空"。
   *
   * 这里单独补一条**针对卡头**的委托（用 closest 到 `.setcard-head`），
   * 而不是往白名单里塞 `.setcard-head`：卡头里的按钮（比如"撤销本次设置"、
   * 峰谷时段那组控件）本来就会被白名单命中，若把卡头也加进去，
   * 点那些按钮会**同时**命中按钮与卡头 → 响两声。
   * 用"仅当点击目标不在可点控件上时才补卡头音"来避免叠加。
   */
  const CARD_CTRL = 'button, .btn, a, input, select, textarea, label, .switch, [role="button"]';
  function onCardHeadClick(e) {
    if (document.documentElement.getAttribute('data-skin') !== 'minecraft') return;
    const t = e.target;
    if (!t || !t.closest) return;
    const head = t.closest('.setcard-head');
    if (!head) return;
    // 卡头里的控件自己有音效（点击音/开关音），别叠加
    if (t.closest(CARD_CTRL)) return;
    play(read().clickSfx);
  }
  document.addEventListener('click', onCardHeadClick, true);

  // 皮肤切到 Minecraft 时预载音效
  function onSkinChange() {
    if (document.documentElement.getAttribute('data-skin') === 'minecraft') loadSfx();
  }
  window.addEventListener('qqa-skin-change', onSkinChange);
  // 启动时如果已经是 MC 皮肤，也要载（否则首次点击才现载，第一次点没声）
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onSkinChange, { once: true });
  else onSkinChange();

  window.qqaMcTheme = {
    KEY,
    DEFAULTS,
    BACKGROUNDS,
    SFX,
    SFX_USES,
    BG_OPACITY_MAX,
    read,
    write,
    reset,
    applyToDocument,
    play,
    playToggle,
    loadSfx,
    /** 某个音效名在给定方向下会用哪些文件（供设置页/验证用） */
    filesFor,
    /** 全部需要的音频文件（去重） */
    allFiles,
    /** 已解码的文件名（供验证/调试） */
    loaded: () => [...buffers.keys()],
    /** 当前 AudioContext 状态（'running' | 'suspended' | null） */
    ctxState: () => (audioCtx ? audioCtx.state : null)
  };
})();
