// 截整窗 + 采样关键区域的实际像素，用来确认"任务栏/导航栏/内容区"以及拉杆开关的观感。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
const OUT = process.argv[3] || 'shots/final/mc-light.png';

function dec(p) {
  const png = fs.readFileSync(p);
  let off = 8, w = 0, h = 0, ct = 6; const idat = [];
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9]; }
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const chn = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * chn;
  const out = new Uint8ClampedArray(w * h * 4);
  const prev = Buffer.alloc(stride); const cur = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); };
  for (let y = 0; y < h; y += 1) {
    const ft = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= chn ? cur[i - chn] : 0, b = prev[i], c = i >= chn ? prev[i - chn] : 0;
      let v = cur[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) v += paeth(a, b, c);
      cur[i] = v & 0xFF;
    }
    for (let x = 0; x < w; x += 1) {
      const si = x * chn, di = (y * w + x) * 4;
      out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2];
      out[di + 3] = ct === 6 ? cur[si + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, data: out };
}
const px = (im, x, y) => {
  const i = (y * im.w + x) * 4;
  return `rgb(${im.data[i]},${im.data[i + 1]},${im.data[i + 2]})`;
};

await withPage({ url: URL_, width: 1400, height: 900 }, async (page) => {
  await page.waitFor(`!!window.qqaSkin && typeof window.qqaSkin.set === 'function'`, { timeout: 20000, label: 'qqaSkin' });
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); window.applyTheme && window.applyTheme('light', null, { animate: false }); return 1; })()`);
  await page.waitFor(`document.documentElement.dataset.skin === 'minecraft'`, { timeout: 10000, label: 'MC' });
  await sleep(1200);

  // 打开设置页。
  // ⚠️ 必须**点导航标签**，不能 `page.eval('switchTab("settings")')`。
  //    `switchTab` 是模块作用域里的函数、**不是 window 属性**，
  //    page.eval 在页面全局作用域求值 → 直接 ReferenceError；
  //    而我当时用了 try/catch 把它吞掉了，于是"点了设置页但什么都没发生"：
  //    loadSettings() 没跑 → state.config 永远 null → 设置页渲染失败。
  //    这在界面上看起来完全像应用坏了，实际是**探针自己没点对**。
  //    教训：模拟用户操作就点真实元素，别去调内部函数。
  await page.waitFor(`!!document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '设置页签' });
  await page.eval(`(() => {
    const t = document.querySelector('#tabs .tab[data-tab="settings"]');
    t.click();
    return 1;
  })()`);
  await page.waitFor(`!!document.querySelector('.settings-menu-item[data-section]')`, { timeout: 30000, label: '设置菜单出现' });
  // 等配置真正到位（菜单出现了但 config 可能还在路上）
  await page.waitFor(`!!document.querySelector('#settings-form h3, #settings-form .setcard')`, { timeout: 30000, label: '设置内容渲染' });
  await sleep(900);
  // 再切到「工具与技能」区块（同样点真实菜单项）
  await page.eval(`(() => {
    const b = document.querySelector('.settings-menu-item[data-section="tools"]');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(1200);

  /**
   * 展开当前区块里所有折叠卡再截图。
   * 折叠卡收起时内容 `display:none`，里面的 .switch 量不到尺寸 ——
   * 第一版就是这么得到"可见 0"，差点误判成"拉杆没生效"。
   */
  await page.eval(`(() => {
    const box = document.getElementById('settings-form');
    if (!box) return 0;
    let n = 0;
    box.querySelectorAll('.setcard:not(.open) > .setcard-head').forEach((h) => { h.click(); n += 1; });
    return n;
  })()`);
  await sleep(1400);
  await page.screenshot(OUT);

  const im = dec(OUT);
  console.log(`截图：${OUT}  ${im.w}×${im.h}`);
  console.log('  标题栏区 (y=12)      : ' + px(im, 700, 12));
  console.log('  功能条区 (y=68)      : ' + px(im, 700, 68));
  console.log('  导航栏区 (x=80,y=300): ' + px(im, 80, 300));
  console.log('  内容区  (x=700,y=400): ' + px(im, 700, 400));

  // 数一下页面上有多少个 .switch，以及它们的轨道尺寸（确认拉杆尺寸生效）
  const sw = await page.eval(`(() => {
    const all = [...document.querySelectorAll('.switch')];
    const vis = all.filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    const first = vis[0];
    const track = first ? first.querySelector('.track') : null;
    const thumb = first ? first.querySelector('.thumb') : null;
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const tr = cs(track), th = cs(thumb);
    return {
      total: all.length, visible: vis.length,
      track: tr ? { w: tr.width, h: tr.height, bg: tr.backgroundColor, radius: tr.borderRadius } : null,
      thumb: th ? { w: th.width, h: th.height, radius: th.borderRadius, bg: th.backgroundImage.slice(0, 40) } : null
    };
  })()`);
  console.log('  .switch：总数 ' + sw.total + '，可见 ' + sw.visible);
  console.log('    track ' + JSON.stringify(sw.track));
  console.log('    thumb ' + JSON.stringify(sw.thumb));
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
