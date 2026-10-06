# 文档总索引（移交说明）

> 本项目的记录原先散落在 `docs/design-notes.md`（2301 行编年史）与各文件的顶部注释里。
> 2026-10-07 做了一次**面向交接**的整理：抽出 6 份专题文档 + 1 份根 README，
> 原编年史**原样保留**作为可追溯的一手记录。
>
> 本文件说明**这套记录是怎么组织的、要去哪里找什么、以及哪些数字是有校验的**。

---

## 一、按"我要做什么"找

| 我要… | 读这份 |
|---|---|
| 接手这个项目，先搞清**哪些事不能做** | [`HANDOFF-WILL.md`](HANDOFF-WILL.md) ← **从这里开始** |
| 快速跑起来、知道命令是什么 | 根目录 [`../README.md`](../README.md) |
| 改代码后怎么部署、有哪些工具 | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| 跑验收 / 写一条新验收 | [`TESTING.md`](TESTING.md) |
| 改结构（外壳、样式加载顺序、DOM 契约） | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 改主题/皮肤/MC 外观 | [`THEME-SYSTEM.md`](THEME-SYSTEM.md) |
| 遇到怪问题（界面没变、CSS 不生效、测试假失败…） | [`PITFALLS.md`](PITFALLS.md) |
| 查"这件事当初为什么这么做" | [`design-notes.md`](design-notes.md)（编年史） |

---

## 二、六份专题文档的定位

| 文档 | 性质 | 会不会过期 |
|---|---|---|
| `HANDOFF-WILL.md` | **意图层**：需求原话、硬约束、被否决的做法 | 只在用户改主意时变 |
| `ARCHITECTURE.md` | **结构层**：目录职责、加载顺序、契约 | 改结构时同步 |
| `DEVELOPMENT.md` | **操作层**：四步部署、工具清单、调试手段 | 加工具时同步 |
| `TESTING.md` | **验收层**：42 套件分布、断言纪律 | 加套件时同步 |
| `PITFALLS.md` | **经验层**：症状 → 根因 → 修法 | 只增不减（踩过就记） |
| `THEME-SYSTEM.md` | **外观层**：令牌、字体、音效、背景、图标、拉杆 | 改主题时同步 |

**分层是刻意的**：改一处外观不该让人去翻 2301 行编年史；
而"为什么当初不用 X"这种问题也不该混在操作手册里。

---

## 三、原有文档（保留，仍在用）

| 文档 | 说明 | 与专题文档的关系 |
|---|---|---|
| `design-notes.md` | 编年史（2301 行）。每轮改动的原因、实测数据、被推翻的判断 | 专题文档是它的**提炼**；要细节回这里查 |
| `deploy-and-rollback.md` | 切换与回退的原始说明（目录约定、三个开关文件） | 与 `DEVELOPMENT.md` §一 一致；这份更贴近"切换机制"本身 |
| `dom-contract.md` | **自动生成**的选择器契约（176 个），`node tools/extract-dom-contract.mjs` 重生成 | `ARCHITECTURE.md` §五 讲的是这条纪律，契约本身在这里 |
| `electron-shell.md` | 无边框外壳的交付记录 + 验证口径（91 断言） | `ARCHITECTURE.md` §六 的详版 |
| `theme-port-feasibility.md` | 把本 UI / MC 主题移植给**别人的** QQ Agent 的可行性分析（三条路线 + 代价） | 与 `THEME-SYSTEM.md` 互补：那份讲"我方怎么实现"，这份讲"怎么搬走" |
| `class-inventory.txt` / `_dom-contract-raw.txt` / `_verify-output.txt` | 工具产物（类名清单、契约原始输出、验证原始输出） | 下划线开头的是"原始输出"，供核对 |

---

## 四、文档里的数字是怎么来的（可复核）

这份文档里出现的**所有统计数字都当场核对过**，不是凭记忆写的。复核命令：

```powershell
cd 'E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next'

# 前端文件数与体积
(Get-ChildItem 'app\ui' -Recurse -File | Measure-Object).Count
[math]::Round((Get-ChildItem 'app\ui' -Recurse -File | Measure-Object Length -Sum).Sum/1MB, 2)

# 回归套件数（数 run-all-checks 里的注册项）
node -e "const s=require('fs').readFileSync('tools/run-all-checks.mjs','utf8');console.log([...s.matchAll(/\[\s*'[^']*'\s*,\s*'([^']+\.mjs)'/g)].length)"

# 工具脚本数
(Get-ChildItem tools -File).Count

# 编年史行数
(Get-Content docs\design-notes.md | Measure-Object -Line).Lines
```

**当前值**（2026-10-07）：前端 70 文件 / 18.1 MB（MC 字体 15.4 MB）、回归 42 套件、
	ools/ 74 个脚本、编年史 2301 行。

> 如果你看到文档里的数字与现状不符，**以命令输出为准**，并顺手更新文档 ——
> 移交文档的价值全在"准确"上，一个过期的数字会让人怀疑整份文档。

---

## 五、维护约定

1. **改了行为就同步对应那份**。改了主题令牌 → `THEME-SYSTEM.md`；
   加了工具 → `DEVELOPMENT.md`；加了套件 → `TESTING.md` 的套件表；
   踩了新坑 → `PITFALLS.md`（**只增不减**）。
2. **编年史只追加，不改写历史**。`design-notes.md` 里有若干"当时的判断后来被推翻"的记录，
   那是**故意保留**的 —— 它记录了错误的形态与为什么错，比只留正确结论有用得多。
   > 例：CSS `@layer` 那段曾写"样式不用 layer"，后来发现正确做法是
   > `@import url() layer()`。两处都已更正，但在编年史里能看到完整的试错过程。
3. **注释里的引用必须指向真实存在的文件**。整理时发现过若干注释引用已被删除的
   探针脚本（`probe-cascade.mjs`、`probe-disable-sheet.mjs` 等）——
   这类悬空引用比没有注释更糟，因为它会让人去找一个不存在的东西。已全部修正。
4. **同一件事不要在两处写成矛盾的说法**。整理时发现 `index.html` 的注释说
   "不使用任何 layer"，而 `99-legacy-layer.css` 明明用了 `@import ... layer(legacy)` ——
   这种矛盾会直接把人带进坑里。已统一。
