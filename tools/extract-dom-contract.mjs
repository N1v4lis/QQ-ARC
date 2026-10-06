// DOM 契约提取：把移植过来的 JS 实际用到的选择器全部列出来。
// 新壳的 HTML/CSS 必须保证这些选择器仍能解析到正确的节点，否则「功能保持可用」就是空话。
// 用法：node tools/extract-dom-contract.mjs > docs/dom-contract.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UI = path.join(ROOT, 'app', 'ui');
const DIR = path.join(UI, 'app');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
const q = new Map();      // $('...') / $$('...')
const byId = new Map();   // getElementById('...')
const dyn = new Map();    // 动态拼接的选择器（模板串）—— 只能靠人工确认

const push = (map, key, file) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
};

for (const f of files) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const m of s.matchAll(/(?<![\w$.])\$\$?\(\s*'([^']+)'/g)) push(q, m[1], f);
  for (const m of s.matchAll(/getElementById\(\s*'([^']+)'/g)) push(byId, m[1], f);
  for (const m of s.matchAll(/(?<![\w$.])\$\$?\(\s*`([^`]+)`/g)) push(dyn, m[1], f);
}

// 顺带把 index.html 里现有的 id 也列出来，便于对照
const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

const dump = (title, map) => {
  const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const out = [`\n## ${title}（${rows.length}）\n`];
  for (const [k, v] of rows) out.push(`- \`${k}\` — ${[...v].sort().join(', ')}`);
  return out.join('\n');
};

const lines = [];
lines.push('# 新 UI 的 DOM 契约（自动生成，勿手改）');
lines.push('');
lines.push('生成命令：`node tools/extract-dom-contract.mjs > docs/dom-contract.md`');
lines.push('');
lines.push('规则：`app/ui/app/*.js` 是从线上控制台**原样移植**过来的逻辑层。');
lines.push('新壳（index.html）与新版 CSS 必须让下面每个选择器都能解析到语义相同的节点；');
lines.push('做不到的地方必须在 `docs/port-deviations.md` 里逐条登记，不能默默改行为。');
lines.push(dump('$() / $$() 选择器', q));
lines.push(dump('getElementById', byId));
lines.push(dump('模板串里的动态选择器（需人工确认）', dyn));
lines.push('\n## 现有 index.html 里的 id（重写壳时的对照表）\n');
lines.push(htmlIds.sort().map((i) => `- \`#${i}\``).join('\n'));

process.stdout.write(lines.join('\n') + '\n');
