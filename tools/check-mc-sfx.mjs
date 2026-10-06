// ═══════════════════════════════════════════════════════════════════════════
// check-mc-sfx.mjs — 校验 Minecraft 主题打包的音效素材
// ═══════════════════════════════════════════════════════════════════════════
// 这个文件之前是 `gen-mc-sfx.mjs`（**合成**音效的程序）。
// 为什么现在改成校验器：
//   用户后来把音效全部换成了自己提供的原版素材（Click.wav / 活塞 / 信标 / 击打 / 弓箭 / 拾取），
//   并要求删掉音符盒、拉杆、木石按钮。
//   于是原来那套合成器**一个音效都不再产出** —— 留着它只会让人以为
//   "音效是这个脚本生成的"，改错地方。
//   （"文件不打包"如果只删文件、留着生成它的代码，等于半删 ——
//     本项目在木石按钮那次已经踩过一次，这次一并纠正。）
//
// 现在它做三件事，都是"素材换过之后仍然必要"的：
//   ① 清单与磁盘**双向对齐**：02-mc-theme.js 里登记的每个文件都必须存在；
//      磁盘上也不该有登记之外的多余 wav（多出来的会白占体积、还会让人以为在用）。
//   ② 校验 WAV 头合法（RIFF/WAVE + fmt 块），浏览器 decodeAudioData 才吃得下。
//   ③ 报告格式与时长，便于发现"某个素材采样率/声道数异常"这类问题
//      （用户给的 Click.wav 是立体声 38.32kHz，与其它单声道素材不同 ——
//        能跑通，但值得显式知道）。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'app/ui/assets/mc/sfx';
const RUNTIME = process.argv[3] || 'app/ui/shell/02-mc-theme.js';

// ── 从运行时源码里抽出登记的文件名（不 import，因为那是浏览器侧的 IIFE）──
const src = fs.readFileSync(RUNTIME, 'utf8');
const declared = new Set();
// 匹配 files: ['a.wav', ...] / on: 'x.wav' / off: 'y.wav'
for (const m of src.matchAll(/\b(?:files|on|off)\s*:\s*(\[[^\]]*\]|'[^']*')/g)) {
  for (const f of m[1].matchAll(/'([^']+\.wav)'/g)) declared.add(f[1]);
}

// ── 磁盘实际文件 ───────────────────────────────────────────────────────────
const onDisk = new Set(fs.readdirSync(DIR).filter((f) => f.endsWith('.wav')));

function parseWav(buf) {
  if (buf.length < 44) return { ok: false, why: '文件太短' };
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') return { ok: false, why: `${riff}/${wave} 不是 RIFF/WAVE` };
  // 逐块扫描 fmt/data（不要假设 fmt 一定在 12..36 —— 有些素材带 LIST 块）
  let off = 12;
  let fmt = null;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22)
      };
    } else if (id === 'data') {
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);      // 块按偶数字节对齐
  }
  if (!fmt) return { ok: false, why: '没有 fmt 块' };
  if (fmt.audioFormat !== 1) return { ok: false, why: `不是 PCM（format=${fmt.audioFormat}）` };
  if (!dataLen) return { ok: false, why: '没有 data 块' };
  const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
  return { ok: true, fmt, dataLen, ms: Math.round((dataLen / bytesPerSec) * 1000), bytes: buf.length };
}

let failed = 0;
console.log(`清单登记 ${declared.size} 个文件，磁盘上 ${onDisk.size} 个\n`);
console.log('文件                   声道  采样率   位深   时长     体积');
const rows = [];
for (const f of [...declared].sort()) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) {
    console.log(`✗ ${f}  登记了但文件不存在`);
    failed += 1;
    continue;
  }
  const info = parseWav(fs.readFileSync(p));
  if (!info.ok) {
    console.log(`✗ ${f}  WAV 非法：${info.why}`);
    failed += 1;
    continue;
  }
  rows.push(f);
  console.log(`${f.padEnd(22)} ${String(info.fmt.channels).padEnd(5)} ${String(info.fmt.sampleRate).padEnd(8)} ${String(info.fmt.bits).padEnd(5)} ${String(info.ms + 'ms').padEnd(8)} ${(info.bytes / 1024).toFixed(1)}KB`);
}

const extra = [...onDisk].filter((f) => !declared.has(f));
if (extra.length) {
  console.log(`\n✗ 磁盘上有清单未登记的多余文件（白占体积、且让人以为在用）：${extra.join(', ')}`);
  failed += extra.length;
}
const missing = [...declared].filter((f) => !onDisk.has(f));
if (missing.length) failed += 1;

console.log('');
if (failed) {
  console.log(`✗ ${failed} 项问题。`);
  process.exit(2);
}
console.log(`✔ ${rows.length} 个音效素材全部合法，清单与磁盘一致。`);
