# 测试与验收

> 启动动画增量：总入口现为43套件，新增 check-startup（21项），覆盖同一粒子对象、13时刻亮暗一致、最终像素静止、移动、减弱动态效果、真实ready与故障降级。verify-startup-electron单独验证真实绘制与窗口按钮。页面命中/像素检查在每次导航后等待loading-overlay摘除，不能仅等待固定2600ms。

> 2026-10-07：酒狐删除守卫已由 `check-wine-fox.mjs` 替代，套件总数仍为42。
> 新验收覆盖真实鼠标 / 触屏、透明区域输入、弹窗隔离、情绪计时、完整46动作与启停性能。
> `check-fox-removed.mjs` 仅为旧命令的兼容入口；下文删除守卫章节保留为历史经验。
> 真机单独运行 `node tools/restart-agent.mjs --apply --cdp-port 9224`，随后
> `node tools/verify-wine-fox-electron.mjs`。检查后正常重启关闭调试端口。

**总入口**：

```powershell
node tools/run-all-checks.mjs 'http://127.0.0.1:3210/'
# → 42 套件，约 10 分钟
# → 失败套件的所有 ✗ 行会写到 shots/final/regression-failures.txt
```

**前置条件**：QQ Agent 必须**在线**（回归全程需要它，且它必须保持在线）。
跑之前确认：

```powershell
node tools/restart-agent.mjs --status     # 应报"在线 HTTP 200"
```

> ⚠️ 机器内存是硬约束（15.7 GB 总量，跑回归时可能只剩 2.5~4 GB）。
> 历史上引入过同步软件光栅化的功能，把应用拖到 `AppHangTransient` 而**整个进程消失**，
> 表现为"回归跑到第 28 套时应用没了"。**别再引入同步重计算**。
> 如果回归中途应用挂了：先 `restart-agent --apply` 把它拉起来，再判断是套件问题还是资源问题。

---

## 一、42 套件分布

### 基础与结构（先跑，坏了后面都不必看）

| 套件 | 脚本 | 覆盖 |
|---|---|---|
| 样式表结构 | `check-css-structure.mjs` | 孤儿声明 / 块闭合完整（**排第一位**：结构坏掉时视觉断言没意义） |
| 文档引用校验 | `check-doc-refs.mjs` | 文档里的文件引用是否指向真实存在的文件。**分两类**：指南类悬空=失败；编年史刻意提到的历史项=正常（只告知） |
| 宿主插件注入 | `check-plugin-inject.mjs` | 托管插件往部署界面注入的东西是否还在（`apply-ui` 会冲掉它）。环境不具备时**自动跳过**，不在别的机器上误红 |
| MC音效素材 | `check-mc-sfx.mjs` | 音效清单 ↔ 磁盘**双向**一致 + WAV 合法性 |
| 外壳静态结构 | `check-shell-markup.mjs` | `index.html` 必备节点与注册 |
| 无痕（像素级） | `check-seamless-pixels.mjs` | 顶栏/内容区之间**不许出现色差线**（暗色下最容易露） |
| CSS 是否加载 | `check-css-loaded.mjs` | 各样式表真的进来了（404/stale 会在这里暴露） |

### 外壳与导航

`check-nav-color-continuity` · `check-nav-consistency`（底部入口）· `check-nav-rail`（折叠）·
`check-shell-toolbar` · `check-reload-button` · `check-sidebar-width`（无截断）·
`check-sidebar-regroup`（重组 + SnowLuma 整合）· `check-log-fold`

### 仪表盘

`check-dashboard`（卡片/胶囊/按钮）· `check-dashboard-charts`（图表/字号/CNY 刻度）·
`check-dashboard-beta`（提示条）· `check-beta-pin`（通告钉住）·
`check-dash-range`（区间选择 + 侧栏分区间隔）· `check-card-jump-highlight`（卡片跳转高亮）·
`check-tooltip-fixes`（悬停提示）· `check-readout-layout`（读数行布局）

### 主题与 MC 皮肤

| 套件 | 覆盖 |
|---|---|
| `check-theme-page` | 主题卡页 + MC 皮肤 + 二级设置分组 |
| `check-mc-theme` | MC 图标 / 音效 / 拉杆 / 背景 / 字体（最大的一个，21 KB） |
| `check-font-chain` | 字体链逐字形比对（19 个字符，防标点乱码回来） |
| `check-mc-fixes` / `check-mc-fixes2` | 两轮修复的固化（字体/联动/音效清理/字重/Beta 字体） |
| `check-theme` | 亮度两档（**不是**三档 —— 见 `HANDOFF-WILL.md` §2.1） |
| `check-theme-picker` | 主题选择器 |
| `check-motion` | 动效开关 |
| `check-tier-buttons-theme` | 档位按钮几何/对比度 |

### 设置页

| 套件 | 覆盖 |
|---|---|
| `check-settings-fixes` | 输入框等宽对齐 / 撤销按钮高度中性且贴标题 / 重渲染后按钮复活 |
| `check-dom-contract` | 逻辑层依赖的选择器都能解析到语义相同的节点 |
| `check-slider-switch` | 滑条与开关 |
| `check-personalize` | 个性化（配色 / 动效开关 / 主题扩散） |
| `check-color-format` | 颜色格式互转 |

### 其它

`check-markets`（原生入口与市场页）· `check-snowluma-logs` · `check-snowluma-live`
（实时滚动；**会先看日志文件 mtime**：文件很久没写 + 0 事件 = 跳过并说明，不是失败）·
`check-styles` · `check-fox-removed`（见 §三）· `check-occlusion`（遮挡测试）·
`check-console`（控制台报错）

> **顺序是有讲究的**：`run-all-checks` 把"会改主题/改配色/滚动页面"的套件放后面，
> 减少互相影响。`check-occlusion` 与 `check-console` 排在最后。

---

## 二、怎么写一条新的 CDP 验收

所有浏览器侧断言都基于 `tools/cdp.mjs`（**无第三方依赖**，Node 22+ 内置 WebSocket）。

```js
import { withPage, sleep } from './cdp.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

await withPage({ url: 'http://127.0.0.1:3210/', width: 1400, height: 900 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: '界面就绪' });
  // ... 断言
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });

console.log(`\n${pass} 项通过，${fail} 项失败。`);
process.exit(fail ? 2 : 0);
```

**退出码约定**：`0` 通过、`2` 有断言失败、`1` 脚本自身异常。

新套件写好后加进 `tools/run-all-checks.mjs` 的数组即可（它会自动纳入统计）。

---

## 三、断言纪律（这个项目的生存线）

这套纪律不是洁癖 —— 每一条都对应一次真实的假失败：

### 1. 不要写死"当前状态"

**反面教材**：`check-mc-theme` 曾断言"恰好 6 个音效"。素材扩到 15 个后它必然失败 ——
而这会**阻止**后续加素材（为了让它绿就得删素材）。
改成"从运行时取清单 + 判全部可解码"。

同类：动画下拉曾断言"全量 >90 条"；数据源换成 26 条通用动作后必失败。
现在断言的是"明显多于一个被裁剪过的集合"。

### 2. 等待条件必须覆盖**随后真正读取的元素**

"只等 A 就去读 B"是固定套路，已造成多次假失败：

- `check-theme`：navigate 之后 `document.body` 还是 null，`getComputedStyle(null)` 抛错
- `check-personalize`：`#theme-btn` 还没绑就 `.click()`
- `check-log-fold`：等待条件只覆盖了运行日志，随后却去读应用日志

**改法**：等**所有**后续要读的东西同时就位。

### 3. 不要用固定 `sleep` 替代就绪判断

机器忙时固定 sleep 一定不够（尤其内存吃紧时）。用 `page.waitFor(条件)`。
确实需要等的地方（如等动画结束）用 sleep 没问题，但**不能拿它当就绪判据**。

### 4. 等待动画下拉这类**异步填充**的控件要重试

内容由 `api.animationNames()` 异步填充；第一次填可能只拿到 1 项。
现做法是 3 次 × 800 ms 重试 + 等"内容就位"（`options.length > N`）再断言。

### 5. 不写死方向/数字，改判**关系**

例：侧栏间距断言改成"组间 > 组内、组间 ≥ 组内 3 倍、组间 ≤ 项高一半"，
而不是写死 `12px`。

### 6. 别用整卡文本匹配判断"分组是否还在"

卡头副标题本身会写"音效 · 背景 · 字体"，用它判断会误判。
**改用 `.pz-group-title` 的分组标题列表。**

### 7. 布尔默认值的陷阱

`if (patch.showDecor != null)` 在默认值是 `false` 时**永远不会触发**（`false != null` 为 true 但其实…）。
判断"这个键在不在"要用 `k in patch`。

### 8. 瞬态失败要区分"工具问题"与"产品问题"

例：`page.screenshot`（整窗截图）偶发超时，而应用一直在线、界面正常 ——
那是**测试工具**的瞬态问题。处理方式是**捕获并打印**，不判失败，但要留痕。

---

## 四、单独跑与排查

```powershell
# 单个套件
node tools/check-settings-fixes.mjs 'http://127.0.0.1:3210/'

# 批量跑才失败？看这个文件里的完整 ✗ 行
Get-Content shots/final/regression-failures.txt
```

**"单跑绿、批量红"的排查思路**：
1. 是不是前一个套件改了状态没还原？（皮肤、主题、滚动位置、localStorage）
2. 是不是等待条件依赖了被前一个套件影响的东西？
3. 是不是应用在跑到这里时已经被拖慢/拖挂了？（先 `restart-agent --status`）

---

## 五、`check-fox-removed.mjs`：一条"守卫型"测试

它不是验收某个功能，而是**守卫一个删除**（酒狐功能，用户明确要求彻底删除）。
12 条断言分两层：

- **文件层面**：17 个路径都不存在、`assets/fox` 目录没了、`index.html` 与设置页无残留
- **运行时层面**：无 `window.qqaFox`、无 `#fox-pet`、无 `data-fox` 节点、
  无酒狐 script/link、**MC 皮肤仍可正常切换**（证明删的是宠物不是皮肤）、控制台干净

**为什么要专门加这条**：删除类需求如果只删不守，下次重构很容易"顺手恢复" ——
把 `<script>` 标签粘回去就能让宠物复活，而没人会注意。

⚠️ 两个写这条测试时踩过的坑，值得所有"守卫型"测试参考：

1. **别把自己判进去**。第一版用 `/fox/i` 整文匹配 `run-all-checks.mjs`，
   而守卫**自己**就注册在里面、文件名也含 fox —— **必然自失败**。
   正确判据是"除本守卫外不应再有别的 fox 套件"。
2. **清单要跟着实际存在过的东西演进**。第一次删除后，有人用新转换器把酒狐
   整份做回来了（模型 id 从 `maid` 改成 `wine-fox`），于是守卫当时是红的 ——
   因为它守的是"`maid` 那套不存在"，而现场是"`wine-fox` 这套存在"。
   现在清单里**两代资产名都列**，并额外断言"恢复工具 `convert-ysm-wine-fox.mjs` 仍在"
   （保留恢复路径、但不保留任何资产与注册）。
