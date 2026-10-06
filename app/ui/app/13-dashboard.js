// ═══════════════════════════════════════════════════════════════════════════
// 13-dashboard.js — 仪表盘页面（风格参考 AdminLTE v3 的 index3）
// ═══════════════════════════════════════════════════════════════════════════
// 参考页 https://adminlte.cn/themes/v3/index3.html 的结构特征：
//   · 一排**小方框信息卡**（small-box）：大数字 + 标签 + 右下角图标，
//     每张卡底部有一条"查看详情 ›"的链接条；
//   · 主图区（左 2/3）放**折线/面积图**，右上角带一个"时间范围"切换；
//   · 侧栏（右 1/3）放**环形图 + 图例**；
//   · 底部再一排信息块（进度/排行）。
// 这里按同样的骨架实现，但**不引入任何图表库**：
//   AdminLTE 用的是 Chart.js（约 200KB），而这个页面的数据形状很固定
//   （一串日/小时数值 + 一张占比表），用 SVG 手绘折线 + stroke-dasharray 画环形
//   只要几十行，而且能跟着主题变量走（Chart.js 要先读 CSS 变量再喂给它）。
//
// 数据来源（全部复用已有接口，不新增后端）：
//   /api/usage/stats?range=7d    → totals / days / hours / mode / rangeLabel / toolCounts / searchCount
//   /api/usage/breakdown         → 按模型 / 按会话的明细（环形图与排行）
//   /api/status                  → OneBot 连接、模型、暂停等运行状态
//   /api/chats                   → 会话总数
//   /api/accounts                → 账号数
'use strict';

/** 页面状态：只存"这次渲染用的原始数据"，避免重复请求 */
let dashData = null;
/** 图表指标：cost（成本）| runs（调用次数）—— AdminLTE 那排按钮的对应物 */
let dashMetric = 'cost';
/** 加载序号：保证"同一时刻只认最后一次加载"，防止旧请求覆盖新结果（见 loadDashboard） */
let dashLoadToken = 0;
/** Beta 通告"是否已钉住"的观察器；每次重渲染要断开旧的（见 bindBetaPin） */
let dashBetaPinObserver = null;

/* ── 数据区间（2026-10-05 用户要求："最近 7 天 · 图上 7 天"改成用户可选）──────
   取值范围与后端 resolveRange() 一致（today / 7 / 30 / all），也与用量页的
   USAGE_RANGES 对齐 —— 两页看到的口径必须是同一套，否则用户会发现
   "同样选 30 天，仪表盘和用量页数字不一样"。
   ⚠️ 不复用 USAGE_RANGES 常量本身：那是用量页的选择器语义，
      两页将来可能各自增删选项（后端上限 30 天），绑在一起会互相牵制。
      但**值**保持一致，因为后端只认这几个。 */
const DASH_RANGES = [
  ['today', '今天'],
  ['7', '近 7 天'],
  ['30', '近 30 天'],
  ['all', '全部']
];
const DASH_RANGE_KEY = 'qqa-dash-range';
/** 当前区间。默认 '7'（与后端默认一致） */
let dashRange = (() => {
  try {
    const v = localStorage.getItem(DASH_RANGE_KEY);
    return DASH_RANGES.some(([k]) => k === v) ? v : '7';
  } catch { return '7'; }
})();
function setDashRange(v) {
  if (!DASH_RANGES.some(([k]) => k === v)) return;
  dashRange = v;
  try { localStorage.setItem(DASH_RANGE_KEY, v); } catch { /* 隐私模式忽略 */ }
}

/** 一次请求失败不该让整页空白，所以每个接口都单独兜住 */
async function dashSafe(p, dflt) {
  try { return await api(p); } catch { return dflt; }
}

/** 折线/面积图：把一串数值画成 SVG。返回 SVG 字符串。 */
function dashLineChart(values, labels, opts = {}) {
  const w = 720;
  const h = 220;
  const pad = { l: 46, r: 12, t: 14, b: 26 };
  const n = values.length;
  if (!n) return '<div class="dash-empty">暂无数据</div>';
  const max = Math.max(...values, opts.minMax || 0, 1);
  // 顶部留 12% 空白，曲线不会贴到边框上
  const top = max * 1.12;
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const x = (i) => pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => pad.t + plotH - (Math.max(0, v) / top) * plotH;

  const pts = values.map((v, i) => [x(i), y(v)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  // 面积 = 折线 + 回到底边闭合
  const area = `${line} L${pts[n - 1][0].toFixed(1)} ${(pad.t + plotH).toFixed(1)} L${pts[0][0].toFixed(1)} ${(pad.t + plotH).toFixed(1)} Z`;

  // 横向网格线 4 条 + 左侧刻度
  const gridRows = 4;
  const grid = Array.from({ length: gridRows + 1 }, (_, i) => {
    const gy = pad.t + (i / gridRows) * plotH;
    const val = top * (1 - i / gridRows);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${w - pad.r}" y2="${gy.toFixed(1)}" class="dc-grid"/>`
      + `<text x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" class="dc-ytick">${dashAxisFmt(val, opts.metric)}</text>`;
  }).join('');

  // x 轴标签：最多 7 个，避免挤在一起
  const step = Math.max(1, Math.ceil(n / 7));
  const xticks = labels.map((lb, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const short = String(lb).replace(/^\d{4}-/, '').replace(/^\d{2}-\d{2}$/, (m) => m);
    return `<text x="${x(i).toFixed(1)}" y="${h - 8}" class="dc-xtick">${dashEsc(short)}</text>`;
  }).join('');

  // ── 命中区：**收紧到顶点附近**，不是整条竖带 ──────────────────────────
  // 上一版铺的是"整高竖带"（hitH = plotH），好处是不用对准，但副作用是
  // **只要在这条竖线的任意高度都会触发**，用户反馈"判定太松"。
  // 现在改成顶点周围一个小方块：水平 ±HIT_W/2、垂直 ±HIT_H/2。
  // 取 26×26 的依据：圆点半径 2.6 + "容易点中"的余量；
  // 太小会回到"原生 title 让人以为没反应"的老问题，太大就又是整条带。
  const HIT_W = 26;
  const HIT_H = 26;
  const groups = pts.map(([px, py], i) => {
    const hx = Math.max(pad.l, Math.min(px - HIT_W / 2, w - pad.r - HIT_W));
    const hy = Math.max(pad.t, Math.min(py - HIT_H / 2, pad.t + plotH - HIT_H));
    const main = dashPointFmt(values[i], opts.metric);
    // 另一个口径的数值：优先用调用方给的 altValues（真实成本/次数），
    // 没给就退回"同一个值换个格式"（至少不会显示错的数字）
    const altRaw = Array.isArray(opts.altValues) ? opts.altValues[i] : values[i];
    const altKey = opts.metric === 'runs' ? '成本' : '调用';
    return `
      <g class="dc-hit" data-i="${i}"
         data-cx="${px.toFixed(1)}" data-cy="${py.toFixed(1)}"
         data-label="${dashEsc(labels[i] || '')}"
         data-main="${dashEsc(main)}"
         data-alt="${dashEsc(dashPointFmt(altRaw, opts.metric === 'runs' ? 'cost' : 'runs'))}"
         data-alt-key="${altKey}">
        <rect x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${HIT_W}" height="${HIT_H}" fill="transparent"/>
        <line class="dc-guide" x1="${px.toFixed(1)}" y1="${pad.t.toFixed(1)}" x2="${px.toFixed(1)}" y2="${(pad.t + plotH).toFixed(1)}"/>
        <circle class="dc-dot dc-dot-hi" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.4"/>
      </g>`;
  }).join('');
  const dots = pts.map(([px, py], i) =>
    `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6" class="dc-dot"/>`
  ).join('');

  return `
    <div class="dc-wrap">
      <svg class="dc-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="趋势图">
        <defs>
          <linearGradient id="dcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--q-accent)" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="var(--q-accent)" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${grid}
        <path d="${area}" fill="url(#dcFill)"/>
        <path d="${line}" class="dc-line"/>
        ${dots}
        ${xticks}
        ${groups}
      </svg>
      <div class="dc-tip" role="tooltip" aria-hidden="true"></div>
    </div>`;
}

/**
 * 给折线图接上悬停提示。
 * 为什么用事件委托（挂在容器上）而不是给每个 .dc-hit 单独绑：
 *   图表每次重绘（切指标、刷新数据）都会换掉整段 SVG，
 *   逐元素绑定就得每次解绑重绑；委托一次装好、重绘后依然有效。
 */
function bindChartHover(scope) {
  const wrap = scope.querySelector('.dc-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.dc-tip');
  const svg = wrap.querySelector('.dc-chart');
  if (!tip || !svg) return;
  let pinned = false;

  const show = (hit) => {
    const g = hit.closest ? hit.closest('.dc-hit') : null;
    if (!g) return;
    wrap.querySelectorAll('.dc-hit.on').forEach((el) => el.classList.remove('on'));
    g.classList.add('on');
    tip.innerHTML = `<b>${dashEsc(g.dataset.label)}</b>`
      + `<span class="dc-tip-row"><i>本项</i><em>${dashEsc(g.dataset.main)}</em></span>`
      + `<span class="dc-tip-row"><i>${dashEsc(g.dataset.altKey)}</i><em>${dashEsc(g.dataset.alt)}</em></span>`;
    placeTip(g);
    tip.classList.add('on');
    tip.setAttribute('aria-hidden', 'false');
  };

  /**
   * 摆提示框：**优先放顶点上方，上方放不下就放下方**，都不行才夹住。
   *
   * 为什么不能像上一版那样固定贴顶部：顶点若在图的偏上位置，提示框正好压住曲线本身
   * —— 用户要看的就是"这个点在哪"，盖住等于白看。所以位置必须相对于**顶点**算，
   * 并且避开顶点所在的水平带。
   *
   * 坐标换算：SVG 用 viewBox 且 preserveAspectRatio="none"，x/y 两个方向的缩放
   * 比例不同，必须**分别**按 box.width/vb.width 与 box.height/vb.height 换算。
   */
  const placeTip = (g) => {
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = box.width / (vb.width || 1);
    const sy = box.height / (vb.height || 1);
    const px = (Number(g.dataset.cx) - vb.x) * sx;
    const py = (Number(g.dataset.cy) - vb.y) * sy;

    const tipW = tip.offsetWidth || 132;
    const tipH = tip.offsetHeight || 54;
    const GAP = 12;          // 与顶点的垂直净空，避开高亮点与曲线
    const EDGE = 4;

    // 水平：以顶点为中心，夹在容器内
    const left = Math.max(EDGE, Math.min(px - tipW / 2, box.width - tipW - EDGE));

    const roomAbove = py - GAP;
    const roomBelow = box.height - py - GAP;
    let top;
    let above;
    if (roomAbove >= tipH) { top = py - GAP - tipH; above = true; }        // 上方放得下
    else if (roomBelow >= tipH) { top = py + GAP; above = false; }         // 退而放下方
    else { top = Math.max(EDGE, Math.min(py - tipH - GAP, box.height - tipH - EDGE)); above = py > box.height / 2 ? false : true; }

    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(EDGE, top)}px`;
    // 小箭头指向顶点（上方放的箭头在底边，下方放的箭头在顶边）
    tip.classList.toggle('dc-tip-above', above);
    tip.classList.toggle('dc-tip-below', !above);
    // 箭头水平对准顶点（受夹取影响，要按实际左边界反算）
    tip.style.setProperty('--tip-arrow-x', `${Math.max(10, Math.min(px - left, tipW - 10))}px`);
  };

  const hide = () => {
    if (pinned) return;
    wrap.querySelectorAll('.dc-hit.on').forEach((el) => el.classList.remove('on'));
    tip.classList.remove('on');
    tip.setAttribute('aria-hidden', 'true');
  };

  const hitAt = (e) => document.elementFromPoint(e.clientX, e.clientY);
  wrap.addEventListener('mousemove', (e) => {
    const el = hitAt(e);
    if (el && el.closest && el.closest('.dc-hit')) show(el);
    else hide();
  });
  wrap.addEventListener('mouseleave', hide);
  // 点一下"钉住"提示：方便在动来动去的鼠标下读数，再点一下取消
  wrap.addEventListener('click', (e) => {
    const el = hitAt(e);
    if (el && el.closest && el.closest('.dc-hit')) { pinned = !pinned; show(el); if (!pinned) hide(); }
    else { pinned = false; hide(); }
  });
}

/** 环形图：按占比画弧。用 stroke-dasharray 在圆上分段，不需要 path 计算。 */
function dashDonut(rows, opts = {}) {
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  if (!total) return '<div class="dash-empty">暂无数据</div>';
  const R = 54;
  const C = 2 * Math.PI * R;
  const colors = ['var(--q-accent)', 'var(--q-ok)', 'var(--q-warn)', 'var(--q-err)', 'var(--q-accent-hi)', 'var(--q-fg-3)'];
  let acc = 0;
  const segs = rows.slice(0, 6).map((r, i) => {
    const frac = (Number(r.value) || 0) / total;
    const len = frac * C;
    const seg = `<circle class="dd-seg" r="${R}" cx="80" cy="80"
        stroke="${colors[i % colors.length]}"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${(-acc).toFixed(2)}"><title>${dashEsc(r.label)}: ${dashEsc(r.text || r.value)}（${(frac * 100).toFixed(1)}%）</title></circle>`;
    acc += len;
    return seg;
  }).join('');
  const legend = rows.slice(0, 6).map((r, i) => `
    <li class="dd-li">
      <i class="dd-sw" style="background:${colors[i % colors.length]}"></i>
      <span class="dd-name" title="${dashEsc(r.label)}">${dashEsc(r.label)}</span>
      <span class="dd-val">${dashEsc(r.text || String(r.value))}</span>
      <span class="dd-pct">${(((Number(r.value) || 0) / total) * 100).toFixed(1)}%</span>
    </li>`).join('');
  return `
    <div class="dash-donut">
      <svg viewBox="0 0 160 160" class="dd-svg">
        <circle class="dd-track" r="${R}" cx="80" cy="80"/>
        <g transform="rotate(-90 80 80)">${segs}</g>
        <text x="80" y="76" class="dd-center-v">${dashEsc(opts.centerValue || String(rows.length))}</text>
        <text x="80" y="94" class="dd-center-l">${dashEsc(opts.centerLabel || '项')}</text>
      </svg>
      <ul class="dd-legend">${legend}</ul>
    </div>`;
}

/**
 * 纵向柱形图（会话排行用）。
 *
 * 为什么不用"横向进度条列表"那种形态：一行一个条，读起来是**列表**不是**排行**；
 * 条长只有相对意义，也没有刻度可比。
 * 换成真正的柱形图后：同一基线、同一标尺，高低一眼可比。
 *
 * ⚠️ 每个 <rect> 里都放 <title>，柱子上悬停能看到精确数值 ——
 *    与折线图保持一致（用户对"放上去应该有信息"有明确预期）。
 * 名字太长会互相挤压，所以靠 SVG 的 textLength 限制宽度、超出用省略号（见 JS 侧截断）。
 */
function dashBarChart(rows, opts = {}) {
  if (!rows.length) return '<div class="dash-empty">暂无数据</div>';
  const w = 720;
  const h = 240;
  const pad = { l: 48, r: 12, t: 22, b: 54 };   // 底部留够：两行名字
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  const top = max * 1.1;
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const n = rows.length;
  // 每根柱子占的槽宽；柱体占 62%，留出间隙
  const slot = plotW / n;
  const barW = Math.max(6, slot * 0.62);
  const y = (v) => pad.t + plotH - (Math.max(0, v) / top) * plotH;

  // 横向网格 + 左侧刻度（4 条）
  const gridRows = 4;
  const grid = Array.from({ length: gridRows + 1 }, (_, i) => {
    const gy = pad.t + (i / gridRows) * plotH;
    const val = top * (1 - i / gridRows);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${w - pad.r}" y2="${gy.toFixed(1)}" class="dc-grid"/>`
      + `<text x="${pad.l - 8}" y="${(gy + 3.5).toFixed(1)}" class="dc-ytick">${dashAxisFmt(val, opts.metric)}</text>`;
  }).join('');

  /** 名字太长会溢出，按字符数截断（CJK 按 1 个宽度算） */
  const shorten = (s, maxChars) => {
    const str = String(s || '');
    return str.length > maxChars ? `${str.slice(0, maxChars - 1)}…` : str;
  };
  // 柱子越多，名字可用宽度越小：按槽宽反推每行能放几个字
  const charsPerLine = Math.max(3, Math.floor((slot / 11) * 1.0));
  const LABEL_LINES = 2;   // 最多两行：放不下的直接省略

  const bars = rows.map((r, i) => {
    const v = Number(r.value) || 0;
    const bx = pad.l + slot * i + (slot - barW) / 2;
    const by = y(v);
    const bh = Math.max(1, pad.t + plotH - by);
    const name = shorten(r.label || '', charsPerLine * LABEL_LINES);
    const cx = pad.l + slot * i + slot / 2;
    // 柱顶只写**主线指标**（这里就是调用次数）：原来是把 r.text 整个搬上去，
    // 那是"4133 次 · ¥30.08"，压在 10px 小字上又长又挤。
    // 完整信息（含成本）留在 title / 悬停里。
    const short = (typeof opts.barFmt === 'function' ? opts.barFmt(v, r) : String(Math.round(v)));
    return `
      <g class="dc-bar-g">
        <rect class="dc-bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3">
          <title>${dashEsc(r.label || '')}：${dashEsc(r.text || String(v))}</title>
        </rect>
        <text x="${cx.toFixed(1)}" y="${(by - 6).toFixed(1)}" class="dc-bar-val">${dashEsc(short)}</text>
        <text x="${cx.toFixed(1)}" y="${(pad.t + plotH + 16).toFixed(1)}" class="dc-bar-name">${dashEsc(name)}</text>
      </g>`;
  }).join('');

  return `
    <svg class="dc-chart dc-bar-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="会话排行柱形图">
      ${grid}
      ${bars}
    </svg>`;
}

const dashEsc = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
/**
 * 坐标轴刻度格式化。
 *
 * ⚠️ 这里以前对成本用 `toFixed(2)`，于是刻度是 `22.19 / 16.64 / 11.09` 这种 ——
 *    用户明确说"不应该用小数点后两位，用常见的 CNY 计量方式"。
 *    刻度是**给人看量级**的，两位小数既啰嗦又没法一眼读数。
 *    改成人民币习惯写法：小额带 ¥，大额用 k/M 缩写（¥1.2k 比 ¥1,234.56 好读）。
 *    精确到分的两位小数仍然保留在**悬停提示与卡片**里（那里才需要精度）。
 */
const dashAxisFmt = (v, metric) => {
  if (metric === 'runs') return String(Math.round(v));
  const n = Number(v) || 0;
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `¥${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `¥${(n / 1000).toFixed(1)}k`;
  if (abs >= 1) return `¥${n.toFixed(0)}`;      // 整元，不带小数
  // 小于 1 元时保留一位小数已经够表达量级（0.4 而不是 0.4370）
  return `¥${n.toFixed(1)}`;
};
/** 悬停/提示里的精确数值：成本用 fmtYuan（¥ 前缀 + 分），次数用"次" */
const dashPointFmt = (v, metric) => (metric === 'runs' ? `${Math.round(Number(v) || 0)} 次` : (typeof fmtYuan === 'function' ? fmtYuan(v) : String(v)));

/**
 * 小方框信息卡（AdminLTE small-box）。
 *
 * target —— 点击后跳转到哪个页签。
 * flash  —— 跳到那页后要高亮的区块标识（对应用量页的 data-card / data-block）。
 *           与 target 分开是因为**同一页面上有 5 张卡都跳用量页**，
 *           但各自要高亮的区块不同；只用一个 target 的话它们无法区分。
 *           取值用语义名（runs/cost/tokens/rate/search），不用位置序号 ——
 *           卡片顺序将来会调整，序号会静默指错区块。
 *           也允许传数组（如「Token 总量」要同时高亮"输入 token + 输出 token"）。
 */
function dashSmallBox({ label, value, sub, icon, tone, target, flash }) {
  const flashAttr = flash ? ` data-flash="${Array.isArray(flash) ? flash.join(',') : flash}"` : '';
  return `
    <div class="dash-box tone-${tone || 'accent'}"${target ? ` data-goto="${target}"${flashAttr} role="button" tabindex="0"` : ''}>
      <div class="db-main">
        <div class="db-value">${value}</div>
        <div class="db-label">${dashEsc(label)}</div>
        ${sub ? `<div class="db-sub">${sub}</div>` : ''}
      </div>
      <div class="db-icon" aria-hidden="true">${icon}</div>
      ${target ? '<div class="db-foot">查看详情 <span aria-hidden="true">›</span></div>' : '<div class="db-foot db-foot-plain">&nbsp;</div>'}
    </div>`;
}

const DASH_ICON = {
  runs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V6M9 18V10M14 18v-5M19 18V4"/></svg>',
  cost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.6v8.8M14.6 9.6c-.6-.7-1.5-1-2.6-1-1.5 0-2.6.7-2.6 1.8 0 2.6 5.6 1.3 5.6 3.9 0 1.2-1.2 1.9-2.8 1.9-1.2 0-2.2-.4-2.8-1.1"/></svg>',
  tokens: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6l7 3.2v6c0 3.6-2.8 6.4-7 7.6-4.2-1.2-7-4-7-7.6v-6z"/><path d="M9.4 12.2l1.9 1.9 3.6-3.9"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.6" cy="10.6" r="5.6"/><path d="M14.8 14.8L20 20"/></svg>',
  cache: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6.4" rx="7" ry="2.8"/><path d="M5 6.4v11.2c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6.4"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 5.6h14.8v9.2h-8.4l-3.6 3.6v-3.6H4.6z"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.4" r="3.4"/><path d="M5.4 19.4c0-3.1 3-5.2 6.6-5.2s6.6 2.1 6.6 5.2"/></svg>',
  // 插头：表示"连接"
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.6v4.2M15 3.6v4.2M6.4 7.8h11.2v3.4a5.6 5.6 0 0 1-11.2 0zM12 16.8v3.6"/></svg>'
};

/** 渲染整个仪表盘。参数是 loadDashboard 收集好的数据包。 */
function renderDashboard(data) {
  const box = document.getElementById('dashboard-page');
  if (!box || !data) return;
  const { stats, st, chats, accounts, breakdown } = data;

  const t = stats?.totals || {};
  const today = st?.usage || {};
  // /api/usage/stats 的 days 是**从新到旧**排的（实测：[10-03, 10-02, 10-01, …]），
  // 所以画折线前必须反转成时间正序，否则图是"右到左"的（x 轴日期倒着走）。
  // 注意：hours 本来就是 0→23 正序，不要一起反转。
  const days = (stats?.days || []).slice(0, 14).reverse();
  const metric = dashMetric;
  const series = days.map((d) => Number(metric === 'cost' ? d.cost : d.runs) || 0);
  // 另一套口径也一并交给图表：悬停提示里两种数值一起给，
  // 用户不用来回点"成本/调用次数"按钮就能看到完整信息。
  const seriesAlt = days.map((d) => Number(metric === 'cost' ? d.runs : d.cost) || 0);
  const labels = days.map((d) => String(d.day || d.date || ''));

  // 模型占比：⚠️ stats 里的字段名是 **models**（不是 byModel —— 我第一版按后者取值，
  // 结果环形图永远空）。每一项的 label 在 `key` 里，形如 "api.deepseek.com：deepseek-flash"
  // （渠道：模型），直接用它比自己拼 vendor/model 更稳。
  // breakdown 不带 by 时返回的是**按会话分组**的 rows（实测 key = 'group:<id>'），
  // 所以会话维度用 breakdown.rows，模型维度用 stats.models。
  const modelRows = (stats?.models || []).slice(0, 6).map((m) => ({
    label: String(m.key || m.model || '(未知模型)'),
    value: Number(m.cost) || 0,
    text: typeof fmtYuan === 'function' ? fmtYuan(m.cost) : String(m.cost || 0)
  })).filter((r) => r.value > 0);

  // 会话排行：breakdown.rows 的 key 形如 'group:1079189330' / 'private:23369542'。
  // 用 chatNameOf 补群名（有就显示名字，没有就显示 key 的可读形式）。
  const chatRows = (breakdown?.rows || []).slice(0, 8).map((c) => ({
    label: dashChatLabel(c.key),
    value: Number(c.runs) || 0,
    text: `${Number(c.runs) || 0} 次 · ${typeof fmtYuan === 'function' ? fmtYuan(c.cost) : ''}`
  })).filter((r) => r.value > 0);

  const runs = Number(t.runs) || 0;
  const cost = Number(t.cost) || 0;
  const tokens = Number(t.totalTokens) || ((Number(t.promptTokens) || 0) + (Number(t.completionTokens) || 0));
  const rate = (Number(t.cacheHitRate) || 0) * 100;
  const searches = Number(stats?.searchCount) || 0;
  const chatCount = (chats?.chats || []).length;
  const accountCount = (accounts?.accounts || []).length;
  const nSearch = Number(stats?.toolCounts?.web_search) || 0;
  const nFetch = Number(stats?.toolCounts?.web_fetch) || 0;
  const nDays = days.length;

  box.innerHTML = `
    <div class="dash-wrap" data-range="${dashEsc(dashRange)}">
      ${dashBetaNotice()}
      <div class="dash-head">
        <h2>仪表盘</h2>
        <div class="dash-head-right">
          <!-- 数据区间选择器（用户要求："最近 7 天 · 图上 7 天"要可选）。
               HTML 由 dashRangeButtons() 统一产出（骨架态共用同一份，避免写岔）。
               ⚠️ 原来这里是一个只读的 .dash-range 胶囊，显示后端回的 rangeLabel；
                  现在换成真正的按钮组，rangeLabel 退到旁边做"图上 N 天"的提示 ——
                  按钮文字是**我们定义的**（"近 7 天"），rangeLabel 是后端算的
                  （"最近 7 天"），两者措辞不同，且 rangeLabel 是后端**兜底后**的结果，
                  当范围非法时它会静默回落（本轮就发现写死 30d 一直被当成 7 天）。 -->
          ${dashRangeButtons()}
          <span class="dash-range-info" title="后端返回的区间与图上天数">${dashEsc(stats?.rangeLabel || '')}${nDays ? ` · 图上 ${nDays} 天` : ''}</span>
          <button class="btn btn-small" id="dash-refresh-btn" title="立即刷新">刷新</button>
        </div>
      </div>

      <p class="dash-sub">机器人运行总览 · 点击信息卡可跳到对应页面</p>

      <!-- 一排小方框信息卡（AdminLTE small-box）
           ⚠️ 这 5 张卡**各带一个语义化的 flash 目标**：都跳用量页，
              但跳过去后要高亮的区块不同。见 dashSmallBox 的说明。 -->
      <div class="dash-boxes">
        ${dashSmallBox({ label: '调用次数', value: (typeof fmtTok === 'function' ? fmtTok(runs) : runs), sub: `今日 ${today.runs ?? 0} 次`, icon: DASH_ICON.runs, tone: 'accent', target: 'usage', flash: 'runs' })}
        ${dashSmallBox({ label: '估算成本', value: (typeof fmtYuan === 'function' ? fmtYuan(cost) : cost), sub: '所选区间合计', icon: DASH_ICON.cost, tone: 'ok', target: 'usage', flash: 'cost' })}
        ${dashSmallBox({ label: 'Token 总量', value: (typeof fmtTok === 'function' ? fmtTok(tokens) : tokens), sub: `入 ${typeof fmtTok === 'function' ? fmtTok(t.promptTokens) : t.promptTokens} · 出 ${typeof fmtTok === 'function' ? fmtTok(t.completionTokens) : t.completionTokens}`, icon: DASH_ICON.tokens, tone: 'accent', target: 'usage', flash: ['prompt', 'completion'] })}
        ${dashSmallBox({ label: '缓存命中率', value: `${rate.toFixed(1)}%`, sub: `命中 ${typeof fmtTok === 'function' ? fmtTok(t.cachedTokens) : t.cachedTokens}`, icon: DASH_ICON.cache, tone: 'warn', target: 'usage', flash: 'rate' })}
        ${dashSmallBox({ label: '联网搜索', value: (typeof fmtTok === 'function' ? fmtTok(searches) : searches), sub: `搜索 ${nSearch} · 抓取 ${nFetch}`, icon: DASH_ICON.search, tone: 'ok', target: 'usage', flash: 'search' })}
      </div>

      <!-- 第二排：会话数 / 账号数 / 运行状态（都可点跳转） -->
      <div class="dash-boxes dash-boxes-sm">
        ${dashSmallBox({ label: '会话总数', value: String(chatCount), sub: '群 + 私聊', icon: DASH_ICON.chat, tone: 'accent', target: 'chats' })}
        ${dashSmallBox({ label: '账号', value: String(accountCount || 1), sub: '多开分账号', icon: DASH_ICON.account, tone: 'accent', target: 'accounts' })}
        ${dashSmallBox({
          label: 'OneBot 连接',
          value: st?.onebot?.connected ? '已连接' : '未连接',
          sub: st?.onebot?.connected ? '点击查看 SnowLuma' : '点击去连接',
          icon: DASH_ICON.plug,
          tone: st?.onebot?.connected ? 'ok' : 'err',
          // SnowLuma 面板已整合进「设置 → OneBot（SnowLuma）」，
          // 所以这张卡跳到**设置页的 onebot 区块**（由 data-goto 的处理函数识别）。
          target: 'settings',
          flash: 'onebot'
        })}
      </div>

      <!-- 主图区：左 2/3 折线图 + 右 1/3 环形图 -->
      <div class="dash-row">
        <div class="dash-card dash-card-main">
          <div class="dash-card-head">
            <h3>用量趋势</h3>
            <div class="dash-metric">
              <button class="btn btn-small${metric === 'cost' ? ' on' : ''}" data-metric="cost">成本</button>
              <button class="btn btn-small${metric === 'runs' ? ' on' : ''}" data-metric="runs">调用次数</button>
            </div>
          </div>
          <div class="dash-card-body">
            ${dashLineChart(series, labels, { metric, altValues: seriesAlt })}
          </div>
          <div class="dash-card-foot">${nDays ? `近 ${nDays} 天有数据 · 悬停曲线上的点看具体数值` : '所选区间暂无用量数据'}</div>
        </div>

        <div class="dash-card">
          <div class="dash-card-head"><h3>模型成本占比</h3></div>
          <div class="dash-card-body">
            ${dashDonut(modelRows, { centerLabel: '个模型' })}
          </div>
        </div>
      </div>

      <!-- 底部：排行 + 状态信息 -->
      <div class="dash-row">
        <div class="dash-card dash-card-main">
          <div class="dash-card-head"><h3>会话排行（按调用次数）</h3></div>
          <div class="dash-card-body">${dashBarChart(chatRows, { metric: 'runs', barFmt: (v) => (typeof fmtTok === 'function' ? fmtTok(v) : String(Math.round(v))) })}</div>
          <div class="dash-card-foot">${chatRows.length ? '柱形高度即调用次数 · 悬停柱子看精确值' : '所选区间暂无会话数据'}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head"><h3>运行状态</h3></div>
          <div class="dash-card-body">
            <ul class="dash-kv">
              <li><span>机器人</span><b class="${st?.paused ? 'kv-warn' : 'kv-ok'}">${st?.paused ? '已暂停' : '运行中'}</b></li>
              <li><span>模型</span><b title="${dashEsc(st?.orchestrator?.model || '')}">${dashEsc(st?.orchestrator?.model || '未设置')}</b></li>
              <li><span>今日调用</span><b>${today.runs ?? 0} 次</b></li>
              <li><span>今日 Token</span><b>${typeof fmtTokens === 'function' ? fmtTokens(today.totalTokens) : (today.totalTokens ?? 0)}</b></li>
              <li><span>今日成本</span><b>${typeof fmtYuan === 'function' ? fmtYuan(today.cost) : (today.cost ?? 0)}</b></li>
              <li><span>今日搜索</span><b>${today.searchCount ?? 0} 次</b></li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;

  // 交互接线
  box.querySelectorAll('[data-goto]').forEach((el) => {
    const go = () => {
      const flash = el.dataset.flash;
      const goto = el.dataset.goto;
      // 跳到"设置里的某个区块"（如 OneBot/SnowLuma）：走 openSettingsSection，
      // 它会 switchTab('settings') + 设区块 + 重渲染；直接 switchTab('settings')
      // 只会落到上次记住的区块，不一定是想要的那个。
      if (goto === 'settings' && flash && typeof openSettingsSection === 'function') {
        openSettingsSection(flash);
        return;
      }
      // 先登记"跳过去要高亮谁"，再切页签。
      // 顺序很重要：目标页是异步渲染的，切页签会立刻触发它的加载，
      // 渲染完成时再去登记就晚了（那时 flush 已经跑过）。
      if (flash && typeof requestHighlight === 'function') {
        flash.split(',').map((s) => s.trim()).filter(Boolean).forEach((f) => requestHighlight(f));
      }
      if (typeof switchTab === 'function') switchTab(goto);
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  box.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (dashMetric === btn.dataset.metric) return;
      dashMetric = btn.dataset.metric;
      // 切换指标是纯前端行为：用已有数据重画，不重新请求（那两个接口很慢）
      if (dashData) renderDashboard(dashData);
    });
  });
  const rf = box.querySelector('#dash-refresh-btn');
  if (rf) rf.addEventListener('click', () => { dashData = null; loadDashboard({ force: true }); });
  // 数据区间切换：改区间 → 清缓存 → 重新拉。
  // ⚠️ 必须清 dashData：不清的话 loadDashboard 会在 `if (!force && dashData)` 处
  //    直接复用旧数据、只重绘一遍 —— 看起来"点了没反应"。
  box.querySelectorAll('.dash-range[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.range;
      if (v === dashRange) return;
      setDashRange(v);
      dashData = null;
      // 先本地更新按钮态，让点击立刻有反馈（不用等接口回来）
      box.querySelectorAll('.dash-range[data-range]').forEach((b) => {
        const on = b.dataset.range === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      loadDashboard({ force: true });
    });
  });
  // 折线图的悬停提示接线（委托在容器上，重绘后依然有效）
  bindChartHover(box);
  // Beta 通告的"已钉住"状态
  bindBetaPin(box);
}

/**
 * Beta 通告钉住状态。
 *
 * 通告本身是 CSS `position: sticky` 钉住的（见 21-dashboard.css 的说明），
 * 这里只负责一件事：判断它**现在是不是真的处于钉住状态**，是就加 `.is-pinned`
 * （只用来加投影 —— 静止时投影是多余装饰；钉住时内容从下面滚过去，
 * 没有投影会显得卡片"糊"在通告上）。
 *
 * 怎么判断：在通告**之前**插一个 1px 的哨兵元素。
 *   · 哨兵完全可见  → 通告还没到顶，未钉住
 *   · 哨兵滚出视野  → 通告已经贴顶，钉住
 * 不能用 "sticky 元素是否加了 top 偏移"来判断：sticky 不改变元素的 offsetTop，
 * 也没有可监听的状态；`getBoundingClientRect().top` 在钉住前后都是同一个值
 * （这正是 sticky 的作用），拿它做判据必然误判。
 *
 * 用 IntersectionObserver 而不是 scroll 监听：dashboard 刷新频繁、
 * scroll 回调会连带重排，IO 由浏览器在合成阶段处理，开销小得多。
 */
function bindBetaPin(box) {
  const beta = box.querySelector('.dash-beta');
  if (!beta) return;
  // 旧观察器要断开：renderDashboard 每次刷新都会重建 DOM，
  // 不清理的话观察器会越积越多（每个都盯着已脱离文档的旧节点）。
  if (dashBetaPinObserver) { dashBetaPinObserver.disconnect(); dashBetaPinObserver = null; }
  const sentinel = document.createElement('div');
  sentinel.className = 'dash-beta-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  beta.parentNode.insertBefore(sentinel, beta);
  if (typeof IntersectionObserver !== 'function') {
    // 极老环境兜底：直接认为已钉住（有投影总比没有好）
    beta.classList.add('is-pinned');
    return;
  }
  dashBetaPinObserver = new IntersectionObserver((entries) => {
    for (const e of entries) beta.classList.toggle('is-pinned', !e.isIntersecting);
  }, { threshold: 0 });
  dashBetaPinObserver.observe(sentinel);
}

/** 会话 key → 可读标题：group:123 / private:456，能取到群名就用群名。 */
function dashChatLabel(key) {
  const s = String(key || '');
  const m = /^(group|private):(.+)$/.exec(s);
  const id = m ? m[2] : s;
  const kind = m ? m[1] : '';
  if (typeof chatNameOf === 'function') {
    try {
      const nm = chatNameOf(id);
      if (nm) return nm;
    } catch { /* ignore */ }
  }
  return kind === 'group' ? `群 ${id}` : (kind === 'private' ? `私聊 ${id}` : s);
}

/** 拉数据并渲染。
 *
 * ⚠️ 为什么必须**渐进渲染**（2026-10-04 实测踩到）：
 *   `/api/usage/stats?range=30d` 冷启动 **5.3 秒**、`/api/usage/breakdown` **3.9 秒**
 *   （后端要遍历全部会话文件）。一开始我写成 Promise.all 一起等 —— 结果是
 *   "启动落在仪表盘 → 页面停在'正在加载…'五秒以上"，看起来就像坏了。
 *   现在：骨架先出（0ms），五个接口各自回来就各自填，谁慢谁自己转圈。
 *   骨架里带旋转占位块，用户能看出"在加载"而不是"空了"。 */
async function loadDashboard({ force = false } = {}) {
  const box = document.getElementById('dashboard-page');
  if (!box) return;
  // ⚠️ 同一时刻只认最后一次加载（2026-10-04 加）。
  //    没有这个守卫时：连点刷新 / 启动加载与手动刷新叠在一起，
  //    两个请求都在飞，**先发的后到**就会把新结果覆盖成旧数据；
  //    更糟的是刷新会把 dashData 清空，若旧请求中途返回并渲染，
  //    页面会直接停在骨架态（卡上的数字全是占位条）。
  //    用量页早有同类守卫（usageLoadToken），这里对齐。
  const token = ++dashLoadToken;
  if (!force && dashData) { renderDashboard(dashData); return; }

  // 先出骨架（立刻可见，不依赖任何网络）
  box.innerHTML = dashSkeleton();
  // ⚠️ 骨架里也有 Beta 通告（dashBetaNotice 在骨架与正式渲染里都出现），
  //    所以这里也要接一次钉住观察 —— 否则"接口慢、页面停在骨架"的那段时间里，
  //    通告是有的、但滚动时不会进入钉住态（缺 .is-pinned 投影）。
  //    bindBetaPin 内部会先断开上一次的观察器，重复调用安全。
  bindBetaPin(box);

  // ⚠️ range 必须是**当前选择的值**：原来写死 `range=30d`（后端只认 1..30 的数字，
  //    "30d" 会被 Number() 解析成 NaN → 回落成 7 天！），
  //    结果就是"标题说 30 天、数据其实是 7 天"的口径错位。
  //    现在与用量页用同一套 range 值（today / 7 / 30 / all）。
  const enc = encodeURIComponent(dashRange);
  const [stats, st, chats, accounts, breakdown] = await Promise.all([
    dashSafe(`/api/usage/stats?range=${enc}`, null),
    dashSafe('/api/status', null),
    dashSafe('/api/chats', null),
    dashSafe('/api/accounts', null),
    dashSafe(`/api/usage/breakdown?range=${enc}`, null)
  ]);
  // 期间又发起了新的加载 → 这次结果作废（避免旧数据盖新数据 / 停在骨架）
  if (token !== dashLoadToken) return;
  // 用户可能已经切走页签
  if (typeof state !== 'undefined' && state.tab !== 'dashboard') return;
  // ⚠️ 重新确认容器还挂在文档里（renderDashboard 内部会自己再取一次，
  //    但这里先判一次能省掉一次无意义的渲染）。
  //    背景：await 期间容器可能被换成了新节点 —— 那 renderDashboard 会往
  //    游离节点里写，用户看到的仍是骨架。同类问题在 SnowLuma 面板上实测出现过。
  const live = document.getElementById('dashboard-page');
  if (!live || !live.isConnected) return;

  dashData = { stats, st, chats, accounts, breakdown };
  renderDashboard(dashData);
}

/** 数据区间按钮组。正式渲染与骨架共用，避免两处 HTML 写岔。 */
function dashRangeButtons() {
  return `<div class="dash-ranges" role="group" aria-label="数据区间">
    ${DASH_RANGES.map(([v, label]) =>
      `<button class="dash-range${v === dashRange ? ' is-on' : ''}" data-range="${v}"
               type="button" aria-pressed="${v === dashRange ? 'true' : 'false'}"
               title="切换到${label}">${label}</button>`).join('')}
  </div>`;
}

/** 加载骨架：形状尽量贴近真实布局，避免"先空一片、再突然长出来"。 */
function dashSkeleton() {
  const box = '<div class="dash-box"><div class="db-main"><div class="db-value ds-ph" style="width:58%">&nbsp;</div><div class="db-label ds-ph" style="width:40%">&nbsp;</div><div class="db-sub ds-ph" style="width:66%">&nbsp;</div></div></div>';
  return `
    <div class="dash-wrap">
      ${dashBetaNotice()}
      <div class="dash-head"><h2>仪表盘</h2><div class="dash-head-right">${dashRangeButtons()}<span class="dash-range-info">加载中…</span></div></div>
      <p class="dash-sub">正在读取用量与运行状态（首次可能需要几秒，后端要遍历会话文件）…</p>
      <div class="dash-boxes">${box.repeat(5)}</div>
      <div class="dash-row">
        <div class="dash-card dash-card-main"><div class="dash-card-head"><h3>用量趋势</h3></div><div class="dash-card-body"><div class="ds-chart-ph"></div></div></div>
        <div class="dash-card"><div class="dash-card-head"><h3>模型成本占比</h3></div><div class="dash-card-body"><div class="ds-chart-ph" style="height:148px"></div></div></div>
      </div>
    </div>`;
}

/**
 * Beta 测试提示条（照《逃离塔科夫》主菜单那条还原）。
 * 结构 = 左侧黑色六边形感叹号徽章 + 右侧两行文字（第一行加粗放大）。
 *
 * 抽成函数是因为**骨架态与正式态都要渲染它** ——
 * 若只在正式态出现，数据回来那一刻横幅会"突然长出来"、把下面所有内容顶下去，
 * 观感是页面跳了一下。两处共用同一段 HTML 就不会有这个问题。
 *
 * 文案由用户指定，逐字照排（含引号与标点），不要"顺手润色"。
 * 字体走 --q-font-tarkov（见 21-dashboard.css 里关于"中文字体怎么对齐"的说明）。
 */
function dashBetaNotice() {
  return `
    <div class="dash-beta" role="note" aria-label="Beta 测试版本提示">
      <div class="dash-beta-inner">
        <span class="dash-beta-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <!-- 尖顶六边形：中心 (12,12)，上下尖、左右平，与塔科夫那个徽章一致 -->
            <path d="M12 1.6 L21 6.8 L21 17.2 L12 22.4 L3 17.2 L3 6.8 Z" fill="currentColor"/>
            <rect x="10.9" y="6.4" width="2.2" height="7.6" rx="1.1" fill="var(--q-notice-badge-fg)"/>
            <circle cx="12" cy="16.8" r="1.35" fill="var(--q-notice-badge-fg)"/>
          </svg>
        </span>
        <div class="dash-beta-text">
          <p class="dash-beta-line dash-beta-strong">注意！这是“QQ Agent 还没想好叫什么版”的Beta测试版本。</p>
          <!-- 第二行的 "Beta" 与 "测试版本" 之间按用户要求留一个空格 -->
          <p class="dash-beta-line">Beta 测试版本不代表本产品的最终质量。感谢您的理解和支持，祝你好运！</p>
        </div>
      </div>
    </div>`;
}
