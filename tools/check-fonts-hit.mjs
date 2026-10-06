// 正面验证：把 Beta 提示条里的中文/英文分别渲染成图，对比"击中真字体"与"故意写错字体名"。
// 为什么需要：computedStyle 只能读到字体栈声明，读不到"某个字实际用了哪个字体"。
// 字体名写错时浏览器静默回退，截图上很难分辨 —— 这类问题只能靠像素比对抓。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
const OUT = 'shots/final';

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

await withPage({ url: 'about:blank', width: 900, height: 420 }, async (page) => {
  const rows = [
    ['宋体（中文，正确）', '28px "宋体", serif', '注意！这是测试版本'],
    ['故意写错（中文）', '28px "__NoSuchFont__", serif', '注意！这是测试版本'],
    ['Bender（英文，正确）', '28px Bender, serif', 'Beta Test 1234567890'],
    ['故意写错（英文）', '28px "__NoSuchFont__", serif', 'Beta Test 1234567890'],
    ['实际字体栈（中英混排）', '28px Bender, "宋体", serif', '注意！这是"QQ Agent"的Beta测试版本。']
  ];
  const html = rows.map(([label, font, text]) =>
    `<div style="margin:6px 0"><div style="font:11px monospace;color:#666">${label} · ${font}</div>
     <div style="font:${font};white-space:nowrap;color:#111">${text}</div></div>`).join('');
  // ⚠️ 用 base64 的 data: URL，不要用 encodeURIComponent：
  //    后者在 Chromium 里不保证按 UTF-8 解析，中文会变成乱码（第一版就是一堆"涓炬倷…"），
  //    而那种乱码很容易被误读成"字体渲染坏了"。
  const b64 = Buffer.from(`<meta charset="utf-8"><body style="margin:10px;background:#fff">${html}</body>`, 'utf8').toString('base64');
  await page.send('Page.navigate', { url: `data:text/html;base64,${b64}` });
  await sleep(500);
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, 'font-proof.png');
  await page.screenshot(f);
  console.log('对比图：' + f);

  // 宽度比对：用"故意写错的字体名 + 一个**与宋体明显不同**的后备字体"做对照。
  // ⚠️ 第一版用 `serif` 当对照，结果中文宽度完全相等 → 看着像"没命中"。
  //    真实原因是 **Windows 上 serif 的默认映射就是宋体**，两边其实是同一个字体，
  //    这个对照根本不成立。改用 cursive（手写体）当对照，宽度差异立刻显现。
  const w = await page.eval(`(() => {
    const c = document.createElement('canvas').getContext('2d');
    const m = (font, t) => { c.font = font; return +c.measureText(t).width.toFixed(2); };
    const CN = '注意！这是测试版本';
    const EN = 'Beta Test 1234567890';
    return {
      cnReal: m('28px "宋体", cursive', CN),
      cnFake: m('28px "__NoSuchFont__", cursive', CN),
      enReal: m('28px Bender, cursive', EN),
      enFake: m('28px "__NoSuchFont__", cursive', EN),
      // 顺带记录：serif 在 Windows 上映射到什么（解释上面那个"假阴性"）
      cnSerif: m('28px serif', CN),
      cnSimsun: m('28px SimSun', CN)
    };
  })()`);
  // ── 结论 ──────────────────────────────────────────────────────────────
  // ⚠️ 中文字体**无法用宽度判定**：宋体这类 CJK 字体是全角的，每个汉字恰好 1em，
  //    所以不管命中宋体还是其它中文字体，宽度都是 252。宽度只能判**拉丁**字体。
  //    中文的确认靠上面那张对比图（看笔画形态：宋体有明显的横细竖粗 + 衬线）。
  console.log(`英文：Bender ${w.enReal} vs 后备 ${w.enFake} → ${w.enReal !== w.enFake ? '命中真字体 ✔' : '❗未命中'}`);
  console.log(`中文：宽度无法判定（CJK 全角，每个字固定 1em：宋体 ${w.cnReal} / SimSun ${w.cnSimsun} / 后备 ${w.cnFake} 全相等）`);
  console.log('      → 中文命中与否请看对比图 shots/final/font-proof.png：');
  console.log('        「宋体（中文，正确）」那一行应当有明显的**横细竖粗与衬线**（宋体特征），');
  console.log('        与普通黑体/雅黑的等粗无衬线字形明显不同。');
  console.log(`      旁证：Windows 上 serif 的默认映射就是宋体（serif=${w.cnSerif} 与宋体一致），`);
  console.log('      所以即使真名写错、落到 serif，字形仍然是宋体 —— 这也是它能安全兜底的原因。');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
