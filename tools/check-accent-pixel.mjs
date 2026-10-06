// 判断"自定义主色有没有真的画到屏幕上"。
// 计算样式会被 color 过渡中间值干扰（读到的是动画当前帧而不是目标值），
// 所以这里用**像素取样**：
//   1. 把主色改成一个刺眼的值
//   2. 关闭动效避免过渡干扰
//   3. 截激活页签那个区域，数一数目标颜色的像素占比
// 这是"用户真的看得见"级别的证据。
// 用法：node tools/check-accent-pixel.mjs [url]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
const OUT = 'shots/final';

/** 极简 PNG 解码：只处理 8 位 RGBA/RGB 非隔行，够我们截图用。 */
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
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
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

const TARGET = [255, 0, 170];   // #ff00aa
const near = (r, g, b, tol = 26) =>
  Math.abs(r - TARGET[0]) <= tol && Math.abs(g - TARGET[1]) <= tol && Math.abs(b - TARGET[2]) <= tol;

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await sleep(2800);
  // 关掉动效 + 把主色改成刺眼的洋红
  await page.eval(`(() => {
    window.qqaMotion && window.qqaMotion.setPref('off');
    window.qqaColors && window.qqaColors.setColor('--q-accent', '#ff00aa');
    return 1;
  })()`);
  await sleep(800);
  const shape = await page.eval(`(() => {
    const el = document.querySelector('#tabs .tab.active .tab-ico');
    const r = el ? el.getBoundingClientRect() : null;
    return { found: !!el, x: r ? Math.round(r.x) : 0, y: r ? Math.round(r.y) : 0, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
  })()`);
  console.log('激活页签图标：', JSON.stringify(shape));

  const file = path.join(OUT, 'accent-pixel.png');
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot(file);

  const png = decodePng(fs.readFileSync(file));
  // 整屏统计 + 图标邻域统计
  let whole = 0, near1 = 0;
  for (let i = 0; i < png.data.length; i += png.channels) {
    whole += 1;
    if (near(png.data[i], png.data[i + 1], png.data[i + 2])) near1 += 1;
  }
  let box = 0, near2 = 0;
  const x0 = Math.max(0, shape.x - 4), y0 = Math.max(0, shape.y - 4);
  const x1 = Math.min(png.width, shape.x + shape.w + 4), y1 = Math.min(png.height, shape.y + shape.h + 4);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * png.width + x) * png.channels;
      box += 1;
      if (near(png.data[i], png.data[i + 1], png.data[i + 2])) near2 += 1;
    }
  }
  console.log(`整屏命中新主色像素：${near1} / ${whole}`);
  console.log(`激活页签图标区域命中：${near2} / ${box}（${box ? Math.round(near2 / box * 100) : 0}%）`);
  if (near1 > 0) console.log('\n✔ 自定义主色确实画到了屏幕上（像素级证据）');
  else console.log('\n✗ 屏幕上找不到新主色 —— 自定义没生效');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
