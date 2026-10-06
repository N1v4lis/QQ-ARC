// 放大截取 Beta 提示条，用来判断宋体到底清不清晰。
// 为什么必须放大看：1:1 截图里的发虚，肉眼在小图上看不出来；
// 放大 3 倍后笔画边缘是"一刀切"还是"糊成 2~3 像素"一目了然。
import fs from 'node:fs';
import path from 'node:path';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
const OUT = 'shots/final';

await withPage({ url: URL_, width: 1500, height: 980, deviceScaleFactor: 1 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: 'boot' });
  await page.click('#tabs .tab[data-tab="dashboard"]');
  await page.waitFor(`document.querySelector('#dashboard-page .dash-beta')`, { timeout: 20000, label: '提示条' });
  await sleep(800);

  const box = await page.eval(`(() => {
    const el = document.querySelector('#dashboard-page .dash-beta');
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
  })()`);
  console.log('提示条矩形：', JSON.stringify(box));

  fs.mkdirSync(OUT, { recursive: true });
  // ⚠️ `screenshot({clip})` 在这套 CDP 封装里不生效（实测出来还是整屏）。
  //    改用**放大页面**再截：把 devicePixelRatio 提到 3，
  //    浏览器就会按 3 倍设备像素栅格化字体，笔画边缘是硬边还是渐变一眼可辨。
  //    这比"截小图再放大"更真实 —— 它反映的是**同一套字体栅格化在不同 DPR 下**的表现，
  //    而后者只是把已有像素插值放大，看不出栅格化质量。
  for (const scale of [3]) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1500, height: 980, deviceScaleFactor: scale, mobile: false
    });
    await sleep(700);
    const f = path.join(OUT, `beta-dpr${scale}.png`);
    await page.screenshot(f);
    console.log(`DPR=${scale}：${f}`);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1500, height: 980, deviceScaleFactor: 1, mobile: false
    });
    await sleep(400);
  }
  // 同时留一张 1:1 的（用户实际看到的样子）
  {
    const f = path.join(OUT, 'beta-1x.png');
    await page.screenshot(f);
    console.log(`1:1：${f}`);
  }

  // 顺带把关键尺寸打出来，便于核对"是否整数"
  const m = await page.eval(`(() => {
    const beta = document.querySelector('#dashboard-page .dash-beta');
    const inner = document.querySelector('#dashboard-page .dash-beta-inner');
    const badge = document.querySelector('.dash-beta-badge');
    const text = document.querySelector('.dash-beta-text');
    const l1 = document.querySelector('.dash-beta-strong');
    const l2 = document.querySelector('.dash-beta-line:not(.dash-beta-strong)');
    const B = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    const cs = (el) => { const s = getComputedStyle(el); return { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, textAlign: s.textAlign }; };
    return {
      // inner 是否真的存在（我上一轮在这里误判过：inner 缺失时读到的是外层，
      // 于是把 .dash-beta 的 align-items 当成 .dash-beta-inner 的）
      hasInner: !!inner,
      beta: B(beta), inner: B(inner), badge: B(badge), text: B(text),
      betaAlign: getComputedStyle(beta).alignItems,
      innerAlign: inner ? getComputedStyle(inner).alignItems : null,
      line1: cs(l1), line2: cs(l2),
      l2text: (l2 || {}).textContent
    };
  })()`);
  console.log('关键尺寸：', JSON.stringify(m, null, 1));
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
