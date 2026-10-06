// 选择器作用域审计：找出"裸写通用类名"的新样式规则。
//
// 为什么需要它（2026-10-04 两个真实 bug 的同一个根因）：
//   我在 40-market.css 里为了做峰谷滑条，写了裸的 `.track { height:6px; flex:1 }`。
//   但 `.track` 这个名字**被开关组件复用**（`<label class="switch"><span class="track">…`），
//   于是所有开关的轨道被压成 6px 高、宽度被撑开 —— 用户截图里"开关错位"就是这个。
//   同理我给 `.tier-knob` 加了 transform，把靠 left% 定位的滑块"干飞了"。
//
//   这类污染的特点是：**改动的地方看起来很局部**（我确实只想改滑条），
//   但选择器太宽泛，影响面是全局的。肉眼 review 极难发现。
//
// 规则：新样式（styles/ 下除旧皮肤以外）里，出现"裸写通用类名"时给出告警，
//      建议加父级限定（如 `.ac-tier-wrap .track`）。白名单里是已知安全的。
//
// 用法：node tools/check-selector-scope.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'app', 'ui', 'styles');

// 常见的"通用到容易被复用"的类名
const GENERIC = [
  'track', 'thumb', 'switch', 'band', 'knob', 'card', 'panel', 'box', 'item',
  'row', 'field', 'title', 'label', 'input', 'list', 'badge', 'tag', 'chip',
  'header', 'body', 'footer', 'content', 'icon', 'text', 'btn', 'link', 'dot'
];

// ⚠️ 第二类高危：**单字母 + 数字**的短类名（.d2 .d3 .d4 这种）。
// 真实事故（2026-10-04 第五轮）：我给"分群按钮上的小圆点"写了
//   `.ac-tier-wrap .d2, .ac-tier-wrap .d3, .ac-tier-wrap .d4 { width:4px; height:4px }`
// 但档位区间的 class 正是 `tier-band d2 / d3 / d4` —— 选择器**同时命中两者**，
// 于是第 2/3/4 档区间被压成 4×4 圆点、文字被 flex 居中到滑条外面。
// 第 1 档（class 只有 `tier-band`）安然无恙，所以现象是"只有后三档的文字飞走了"。
// 这类短名太容易撞车，值得单独扫出来。
const SHORT_NUMERIC = /(^|[\s,>+~])\.([a-z]{1,2}\d)(?![\w-])/gi;

// 已知安全：这些文件/选择器本身就是"给该通用类定基线"的地方，或已有父级限定
const SAFE_PREFIX = /^(\.q-|#|html|:root|@|\*|\.setcard|\.mcard|\.tool-|\.tool_|\.usage|\.snowluma|\.persona|\.allow|\.ac-|\.pc-|\.fb-|\.sl-|\.tier-|\.theme-|\.settings-|\.session|\.chat-|\.mem-|\.module|\.stat|\.sk-|\.side|\.detail|\.list-|\.empty|\.collapsing|\.qrcode)/;

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== '_legacy-style.css');
const findings = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const lines = src.split(/\r?\n/);
  let inComment = false;
  lines.forEach((line, i) => {
    // 粗略跳过注释行（多行注释用 inComment 跟踪）
    if (inComment) { if (line.includes('*/')) inComment = false; return; }
    if (line.trim().startsWith('/*')) { if (!line.includes('*/')) inComment = true; return; }
    const trimmed = line.trim();
    if (!trimmed.includes('{')) return;
    const selPart = trimmed.split('{')[0].trim();
    if (!selPart || selPart.startsWith('@')) return;
    for (const g of GENERIC) {
      // 该选择器里出现了裸的 .xxx（前面不是字母/数字/-/_/ 点/井号，后面不是字母/数字/-
      const re = new RegExp(`(^|[\\s,>+~])\\.${g}(?![\\w-])(?![\\w-]*[.#:])`);
      if (re.test(selPart + ' ')) {
        if (SAFE_PREFIX.test(selPart)) continue;
        findings.push({ file: f, line: i + 1, selector: selPart, generic: g, kind: 'generic' });
      }
    }
    // 短类名（.d2 等）：只要出现就要报，除非它**只**作为最后一段、且前面有
    // 同名的组件前缀把范围锁死（例如 `.ac-group-dot.d2` —— 但连这种也建议避免）
    SHORT_NUMERIC.lastIndex = 0;
    let m;
    while ((m = SHORT_NUMERIC.exec(selPart)) !== null) {
      findings.push({ file: f, line: i + 1, selector: selPart, generic: m[2], kind: 'short-numeric' });
    }
  });
}

console.log(`扫描 ${files.length} 个新版样式文件（不含旧皮肤）\n`);
if (!findings.length) {
  console.log('✔ 没有发现裸写通用类名 / 短数字类名的规则。');
  process.exit(0);
}
const shortOnes = findings.filter((x) => x.kind === 'short-numeric');
console.log(`⚠️ 发现 ${findings.length} 处可疑选择器（可能污染复用了该类名的其它组件）：\n`);
for (const x of findings) {
  const why = x.kind === 'short-numeric'
    ? `裸用了短类名 .${x.generic} —— 这类名字极易撞车（曾把 .d2 用在档位区间上，被"小圆点"规则压成 4×4）`
    : `裸用了 .${x.generic}，建议加父级限定（如 .ac-tier-wrap .${x.generic}）`;
  console.log(`  ${x.file}:${x.line}  ${x.selector}`);
  console.log(`      → ${why}`);
}
if (shortOnes.length) {
  console.log(`\n其中 ${shortOnes.length} 处是**短数字类名**，优先级最高：`
    + '请确认命中的元素集合与预期一致（probe-rules.mjs 能列出实际命中与胜出规则）。');
}
console.log('\n注意：这些不一定是 bug（要看该通用类是否真的被别处复用）。');
console.log('判断方法：node tools/probe-rules.mjs "<别的组件里用它的元素>" 看这些属性有没有被套上。');
console.log('几何类改动建议同时看 tools/probe-tier-bands.mjs 这类"逐元素打印盒子"的探针。');
process.exit(2);
