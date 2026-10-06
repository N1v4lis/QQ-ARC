// 用"边缘锐度"指标客观比较宋体在不同字号下的清晰度，
// 而不是靠肉眼在截图上判断（截图经过预览缩放后观感不可靠）。
//
// 指标：文字笔画边缘的**梯度强度**。越锐利的字形，边缘从底色到字色的过渡越短
// （理想是 1 像素完成），于是最大梯度越高；发虚的字形过渡铺开成 2~3 像素，
// 最大梯度明显下降。这里统计"强边缘像素占比"与"最大梯度"。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const OUT = 'shots/final';
const SIZES = [17, 18, 19, 20, 21, 22, 23, 24];

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
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const f = raw[rp]; rp += 1;
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += Math.floor((a + b) / 2);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** 在给定矩形内统计水平方向的灰度梯度：越锐的字，强梯度像素占比越高 */
function sharpness(png, x0, y0, x1, y1) {
  const lum = (x, y) => {
    const i = (y * png.width + x) * png.channels;
    return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
  };
  let strong = 0, total = 0, maxG = 0, sumG = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0 + 1; x < x1; x += 1) {
      const g = Math.abs(lum(x, y) - lum(x - 1, y));
      total += 1; sumG += g;
      if (g > 60) strong += 1;          // 强边缘（60/255 以上）说明过渡集中
      if (g > maxG) maxG = g;
    }
  }
  return { strongRatio: total ? strong / total : 0, maxG: Math.round(maxG), avgG: total ? sumG / total : 0 };
}

await withPage({ url: 'about:blank', width: 900, height: 80 * SIZES.length + 40, deviceScaleFactor: 1 }, async (page) => {
  const rows = SIZES.map((s) => `<div id="r${s}" style="height:55px;white-space:nowrap;font-family:Bender,'宋体',SimSun,serif;font-weight:700;font-size:${s}px;color:#14100a;background:#f0a52a;padding:4px 8px">注意！这是“QQ Agent”的Beta测试版本</div>`).join('');
  const b64 = Buffer.from(`<meta charset="utf-8"><body style="margin:0;background:#fff">${rows}</body>`, 'utf8').toString('base64');
  await page.send('Page.navigate', { url: `data:text/html;base64,${b64}` });
  await sleep(500);

  const boxes = await page.eval(`(${JSON.stringify(SIZES)}).map((s) => {
    const el = document.getElementById('r' + s);
    const b = el.getBoundingClientRect();
    return { size: s, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  })`);

  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, 'font-sharpness-scan.png');
  await page.screenshot(f);
  const png = decodePng(fs.readFileSync(f));

  console.log('字号  强边缘占比   最大梯度  平均梯度');
  const rowsOut = [];
  for (const b of boxes) {
    const s = sharpness(png, b.x + 8, b.y + 4, Math.min(b.x + b.w - 8, png.width), b.y + b.h - 4);
    rowsOut.push({ size: b.size, ...s });
    console.log(`${String(b.size).padStart(3)}px ${(s.strongRatio * 100).toFixed(2).padStart(9)}% ${String(s.maxG).padStart(9)} ${s.avgG.toFixed(2).padStart(9)}`);
  }
  const best = rowsOut.slice().sort((a, b) => b.strongRatio - a.strongRatio)[0];
  console.log(`\n强边缘占比最高（最锐）的字号：${best.size}px（${(best.strongRatio * 100).toFixed(2)}%）`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
