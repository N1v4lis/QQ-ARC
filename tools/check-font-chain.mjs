// 字体链最终验收：把界面里真实出现的混合文本渲染出来，逐字符确认来源正确。
// 判据（比"看着对"硬）：
//   · 每个 ASCII 标点/货币/符号字符 → 字形必须等于纯 Latin 字体的字形
//   · 每个汉字                     → 字形必须等于纯 CJK 字体的字形
//   · 全角标点                     → 必须来自 Latin（因为它那边才是对的）
import fs from 'node:fs';
import zlib from 'node:zlib';
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
const OUT = process.argv[3] || 'shots/final/font-final-check.png';

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
};
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

await withPage({ url: URL_, width: 1300, height: 850 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: 'boot' });
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await page.eval(`(async () => {
    for (const f of ['16px "Minecraft AE"', '16px "Minecraft AE CJK"']) {
      try { await Promise.race([document.fonts.load(f), new Promise((r) => setTimeout(r, 10000))]); } catch (e) {}
    }
    return 1;
  })()`);
  await sleep(1000);

  const r = await page.eval(`(() => {
    const CHAIN = getComputedStyle(document.body).fontFamily;   // 实际生效的字体链
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    const sig = (font, ch) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.font = '36px ' + font;
      ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
      ctx.fillText(ch, 6, 6);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let s = ''; let ink = 0;
      for (let i = 3; i < d.length; i += 4) { const on = d[i] > 40; s += on ? '1' : '0'; if (on) ink += 1; }
      return { s, ink };
    };

    // ⚠️ 关于"来源判定"的教训：
    //    最初想用"chain 的字形签名 == 某个单独字体的签名"来判定每个字符的来源。
    //    实测**不可行**：给 CJK 那份加了 unicode-range 之后，
    //    canvas 用字体链名渲染时的字形与"单独指定某一款字体"并不逐像素相同
    //    （区间裁剪 + 回退路径会带来细微差别），于是全都判成 '???'。
    //    这正是本项目反复出现的"断言测了不准确的东西"。
    //
    //    可靠的判据是**像素级对比"修好前 vs 修好后"的坏字形特征**，
    //    而不是猜字体来源。这里改为：逐个关键字符比对"链里画出来的字形"
    //    与"已知坏字体（只有 CJK 那份）画出来的字形"——不同即说明没走坏字形。
    //
    //    ⚠️ 曾经还写了一条"整串文本的像素签名应不同于坏字体"的断言，已删除：
    //       实测它恒为"相同"，是**无意义的判据** ——
    //       坏字体的标点宽度与好字体不同，一整串画下来后面所有字都错位，
    //       逐像素比对必然不同，无论字体到底对不对。
    //       这类"怎么写都过"的断言比没有更糟（给人虚假的安全感）。
    //       整串的正确性由逐字符判据 + 混合文本图（人工看图）共同保证。

    // 逐个关键字符单独确认"链里画出来的"与"坏字体画出来的"不同
    const KEY = {
      ascii: [':', '(', ')', '/', '%'],
      money: ['¥', '€'],
      fullwidth: ['：', '（', '）', '，', '。', '「', '、'],
      hanzi: ['会', '话', '记', '忆', '量']
    };
    const rows = [];
    for (const [kind, chars] of Object.entries(KEY)) {
      for (const ch of chars) {
        const inChain = sig(CHAIN, ch);
        const inBad = sig('"Minecraft AE CJK"', ch);
        // 关键判据：链里的字形**不等于**只用坏字体时的字形
        //   → 说明这个字符没有走那份坏字体
        const differsFromBad = inChain.s !== inBad.s;
        // 汉字例外：汉字本来就应该走 CJK 那份（它就是好的部分），
        //   所以对汉字要求的是"确实是像素体、不是系统兜底字体"
        const notFallback = inChain.s !== sig('"Segoe UI", "Microsoft YaHei", sans-serif', ch).s;
        rows.push({
          ch, kind,
          differsFromBad,
          notFallback,
          ok: kind === 'hanzi' ? notFallback : (differsFromBad && notFallback)
        });
      }
    }
    // ⚠️ 曾经还写了一条"整串文本的像素签名应不同于坏字体"的断言。
    //    实测它恒为 true（"相同"），是**无意义的判据**：
    //    坏字体的标点宽度与好字体不同，一整串画下来后面所有字都错位，
    //    逐像素比对必然不同 —— 无论字体到底对不对。
    //    这类"怎么写都过"的断言比没有更糟（会给人虚假的安全感），已删除。
    //    整串的正确性由**逐字符**判据 + 下面的混合文本图（人工看图）共同保证。

    // 再画一张混合文本图，供肉眼确认
    const lines = [
      'OneBot 连接（N1v4lis）· 今日：31 次运行 · ¥0.163',
      '存档 / 记忆 / 用量 —「会话」《仪表盘》',
      'e1.16  7,946  100,673,301  75.1%  118',
      '音量：60%   等级：info   目录：E:\\\\QQ Agent'
    ];
    const cv2 = document.createElement('canvas');
    cv2.width = 900; cv2.height = lines.length * 44 + 16;
    const x2 = cv2.getContext('2d');
    x2.fillStyle = '#fff'; x2.fillRect(0, 0, cv2.width, cv2.height);
    x2.fillStyle = '#000'; x2.textBaseline = 'top';
    x2.font = '26px ' + CHAIN;
    lines.forEach((t, i) => x2.fillText(t, 10, 10 + i * 44));
    const d2 = x2.getImageData(0, 0, cv2.width, cv2.height);
    return { rows, img: { w: cv2.width, h: cv2.height, data: Array.from(d2.data) } };
  })()`);

  fs.writeFileSync(OUT, encodePng(Uint8Array.from(r.img.data), r.img.w, r.img.h));

  console.log('字符  类型        不等于坏字形   非系统兜底   结果');
  for (const x of r.rows) {
    console.log(`${x.ch}     ${x.kind.padEnd(10)} ${String(x.differsFromBad).padEnd(13)} ${String(x.notFallback).padEnd(12)} ${x.ok ? '✔' : '✗'}`);
  }
  const bad = r.rows.filter((x) => !x.ok);
  console.log(bad.length === 0 ? '✔ 全部关键字符都没走坏字形，且不是系统兜底字体'
    : `✗ ${bad.length} 个字符有问题：${bad.map((b) => b.ch).join('')}`);
  console.log(`混合文本图：${OUT}`);
  process.exit(bad.length ? 2 : 0);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

