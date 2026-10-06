// CSS 结构检查：找出"孤儿声明"—— 出现在规则块之外、或因规则块被意外截断
// 而脱离原有选择器的声明。浏览器遇到这种写法**不会报错**，只会静默丢弃，
// 表现是"样式莫名失效 / 布局塌成默认"，极难从现象反推原因。
//
// 为什么需要这个检查（真实事故，2026-10-05）：
//   给 `.dash-beta` 加 `position: sticky` 时，我把新的 `.dash-beta-sentinel { }`
//   规则**插进了 `.dash-beta { }` 的中间**。后果：
//     · `.dash-beta` 后半段（display:flex / justify-content / padding …）变成孤儿
//       被浏览器丢弃 → 通告内边距没了、徽章与文字从"左右排布"塌成"上下堆叠"；
//     · 紧随其后的 `.dash-beta-inner` 被解析成 `.dash-beta-sentinel .dash-beta-inner`
//       （后代选择器）→ display 计算值退回 block。
//   这一整串只靠 check-dashboard-beta（比对布局矩形）才发现，而且第一次看到
//   "徽章 x == 文字 x"还以为是居中逻辑坏了，查了几轮才定位到是选择器边界问题。
//   所以补一个静态检查，在部署前就拦住。
//
// 实现说明（两个必须避开的坑）：
//   ① 不能直接数 `{` / `}` —— 注释里的花括号（本仓库注释里就写过 CSS 片段）
//      会被算进去，得出"括号不平衡"的错误结论。必须逐字符扫描并跳过注释与字符串。
//   ② 不能把深度 0 出现的任何 `xxx:` 都当成孤儿声明 —— `@import url(...) layer(...)`
//      这类 **at-rule** 天然带冒号且合法。遇到 `@` 开头的语句整条跳过后再判断。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'app/ui/styles';

/** 逐字符扫描：跳过注释与字符串，统计深度并找规则外的声明。 */
function analyze(src) {
  const orphans = [];
  let depth = 0;
  let i = 0;
  let line = 1;
  const n = src.length;

  // 深度 0 时累积的"待判定文本"：用于识别 "prop: value;" 形态
  let buf = '';
  let bufLine = 0;

  const flushOrphan = () => {
    const t = buf.trim();
    // 形态判定：以 属性名: 开头（属性名只含字母/连字符），且不是 at-rule
    if (t && !t.startsWith('@') && /^[a-zA-Z-]+\s*:/.test(t)) {
      orphans.push({ line: bufLine, text: t.slice(0, 90) });
    }
    buf = '';
    bufLine = 0;
  };

  while (i < n) {
    const c = src[i];

    // ── 注释：整段跳过（但要正确累进行号）
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k += 1) if (src[k] === '\n') line += 1;
      i = stop;
      continue;
    }
    // ── 字符串：整段跳过
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    if (c === '{') {
      depth += 1;
      // 进入块内：之前累积的文本（选择器或 at-rule 前导）不是声明
      if (depth === 1) { buf = ''; bufLine = 0; }
      i += 1;
      continue;
    }
    if (c === '}') {
      depth -= 1;
      if (depth < 0) {
        orphans.push({ line, text: '多余的 } （深度已为 0）' });
        depth = 0;
      }
      buf = '';
      bufLine = 0;
      i += 1;
      continue;
    }

    if (depth === 0) {
      if (c === ';') {
        flushOrphan();
      } else {
        if (!bufLine && !/\s/.test(c)) bufLine = line;
        if (buf.trim() || !/\s/.test(c)) buf += c;
      }
    }
    i += 1;
  }
  // 结尾残留（缺分号的最后一条）也判一次
  flushOrphan();

  return { orphans, depth, opens: (src.match(/\{/g) || []).length, closes: (src.match(/\}/g) || []).length };
}

let bad = 0;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.css')).sort();
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const { orphans, depth } = analyze(src);
  if (orphans.length || depth !== 0) {
    bad += 1;
    console.log(`✗ ${f}`);
    if (depth !== 0) console.log(`    扫描结束时仍有未闭合的块（深度 ${depth}）`);
    for (const o of orphans.slice(0, 6)) console.log(`    第 ${o.line} 行有规则外的声明：${o.text}`);
    if (orphans.length > 6) console.log(`    …还有 ${orphans.length - 6} 处`);
  }
}

if (bad) {
  console.log(`\n${bad} / ${files.length} 个样式文件结构异常。`);
  console.log('提示：最常见的原因是**把新规则插进了一个已有规则的中间** ——');
  console.log('      浏览器不报错，只是把它后面的声明悄悄丢弃。请把新规则整块追加到末尾。');
  process.exit(2);
}
console.log(`✔ ${files.length} 个样式文件结构正常（无孤儿声明、块闭合完整）。`);
