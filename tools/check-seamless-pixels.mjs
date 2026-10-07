// 像素级验证"无痕"：沿一条竖线逐行采样，检查
//   1) 标题栏 → 功能条 → 内容区 之间有没有**颜色跳变的横线**
//   2) 各层之间有没有非背景色的行（边框线会表现为 1px 的异色）
// 这是对"无痕"最直接的证据 —— 计算样式说 border=0，但环境里可能还有别的东西在画线
// （实测就抓到了：暗色下 --q-bg-sidebar 与 --q-bg-base 差 6 级明度，
//   在 y=92 处露出一条横贯整窗的色差线，而计算样式里 border 全是 0px）。
//
// 判定方式：在**纯背景区域**取竖线（内容区空白处、窗口最右侧），
// 要求 0~129 行内颜色变化次数 = 0。
// 侧栏那条竖线只取到"侧栏内部"（避开导航文字），它本身是结构分界线、不算接缝。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
const OUT = 'shots/final';
const SCAN_ROWS = 130;
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8 位深');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : (colorType === 2 ? 3 : null);
  if (!channels) throw new Error('只支持 RGB/RGBA');
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp]; rp += 1;
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
const at = (png, x, y) => { const i = (y * png.width + x) * png.channels; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
// ⚠️ 颜色比较要带**感知容差**，不能逐位严格相等：
//    Chromium 在合成/抗锯齿时会产出 ±1 级的像素差（实测暗色下
//    x=1430 处出现 rgb(21,21,23) ↔ rgb(21,21,24)，肉眼看不出任何线）。
//    严格相等会把它判成"有接缝"，属于判据过严 —— 只报**看得见**的色差。
//    阈值 4：相邻两行总差 ≥4 才算一条线（1~3 级差在任何主题下都看不出）。
const TOL = 4;
const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < TOL;
const delta = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

for (const theme of ['light', 'dark']) {
  await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时
  //    （表现为"元素等不到 / 布局像坏了"，其实是没点到）。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
    await sleep(2600);
    await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref', ${JSON.stringify(theme)}); } catch (e) {} return 1; })()`);
    await page.send('Page.navigate', { url: URL_ });
    await sleep(2600);
    await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
      { timeout: 30000, label: '换主题后启动动画与应用就绪' });
    fs.mkdirSync(OUT, { recursive: true });
    const f = path.join(OUT, `seam-${theme}.png`);
    await page.screenshot(f);
    const png = decodePng(fs.readFileSync(f));

    console.log(`\n══════ 主题=${theme} ══════`);
    // ⚠️ 扫描范围只到**外壳层带**为止：标题栏 + 功能条 = 48 + 44 = 92px（去掉工具栏时 40+44=84）。
    //    "无痕"要证明的就是这一段：标题栏 / 功能条 / 内容区三层之间没有横向接缝。
    //    再往下就是页面自己的内容了 —— 那里出现颜色变化是内容（Beta 通告条、卡片、图表），
    //    拿它当"接缝"判失败是判据错了（上一版就因为新增的 Beta 通告条误报）。
    const bandEnd = await page.eval(`(() => {
      const tb = document.getElementById('topbar');
      const bar = document.querySelector('.q-body > .q-tb-status, .q-main > .q-tb-status');
      const main = document.getElementById('layout');
      return {
        titlebarH: tb ? Math.round(tb.getBoundingClientRect().height) : 0,
        toolbarH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
        contentTop: main ? Math.round(main.getBoundingClientRect().top) : 0
      };
    })()`);
    // 多扫 6 行：盖到内容区顶端之下一点，这样"功能条与内容区之间有没有线"才测得到
    const scanTo = Math.max(SCAN_ROWS, bandEnd.contentTop + 6);
    console.log(`  外壳层带：标题栏 ${bandEnd.titlebarH}px + 功能条 ${bandEnd.toolbarH}px → 内容区顶 y=${bandEnd.contentTop}；扫描 0~${scanTo - 1} 行`);

    // 逐行判定"这一行是不是**纯外壳底色**"：
    // 命中 .dash-wrap / .dash-card 等内容容器 → 有内容，跳过（那里的颜色变化是内容本身）。
    const rowMask = await page.eval(`(() => {
      const xs = [1100, 1430];
      const out = {};
      for (const x of xs) {
        const rows = [];
        for (let y = 0; y < ${scanTo}; y += 1) {
          const el = document.elementFromPoint(x, y);
          // 有内容 = 落在页面内容容器内（仪表盘/设置/列表等都会把自己包在这些壳里）
          const isContent = !!(el && el.closest && el.closest('.dash-wrap, .dash-pane, .usage-wrap, .acc-page, .mcard, .setcard, .list-pane, .detail-pane, .memory-wrap'));
          rows.push(isContent ? 0 : 1);
        }
        out['x' + x] = rows;
      }
      return out;
    })()`);

    // 取两条竖线：内容区空白处（x=1100）、窗口最右（x=1430）
    for (const [label, x] of [
      ['内容区空白 x=1100', 1100],
      ['窗口最右 x=1430', 1430]
    ]) {
      const mask = rowMask['x' + x] || [];
      const rows = [];
      for (let y = 0; y < scanTo; y += 1) rows.push({ y, c: at(png, x, y) });
      // 只在"该行是纯外壳底色"的位置检查颜色跳变
      const changes = [];
      let skipped = 0;
      for (let i = 1; i < rows.length; i += 1) {
        if (!mask[i] || !mask[i - 1]) { skipped += 1; continue; }
        if (!same(rows[i].c, rows[i - 1].c)) changes.push({ y: rows[i].y, from: rows[i - 1].c, to: rows[i].c });
      }
      const checked = rows.length - skipped;
      ok(`[${theme}] ${label} 纯底色区域无可见色差（无接缝）`, changes.length === 0,
        changes.length
          ? changes.map((c) => `y=${c.y} ${rgb(c.from)}→${rgb(c.to)}（差 ${delta(c.from, c.to)}）`).join('  ')
          : `已检查 ${checked} 行纯底色 / 共 ${rows.length} 行（容差 ${TOL} 级）${skipped ? `，跳过 ${skipped} 行内容（Beta 通告/卡片）` : ''}`);
    }
    // 侧栏内部：只报告，不作为失败（它上面有导航按钮的文字/图标）
    {
      const rows = [];
      for (let y = 0; y < scanTo; y += 1) rows.push({ y, c: at(png, 110, y) });
      let n = 0;
      for (let i = 1; i < rows.length; i += 1) if (!same(rows[i].c, rows[i - 1].c)) n += 1;
      console.log(`  侧栏内部 x=110：颜色变化 ${n} 处（含导航按钮图形，仅报告不计失败）`);
    }
  }).catch((e) => { console.error('FAIL', e); process.exit(1); });
}

console.log(failed ? `\n${failed} 项未通过 —— 仍有可见接缝。` : '\n无痕验收通过：内容区与窗口边缘全程没有横向接缝。');
process.exit(failed ? 2 : 0);
