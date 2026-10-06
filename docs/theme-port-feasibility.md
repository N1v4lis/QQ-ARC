# 把「新 UI + MC 主题」移植到别人的 QQ Agent —— 可行性分析

> 输入：对方主题开发文档 `theme-development.md`（主题包机制：`resources/app/ui/themes/<id>/` + `theme.json` + `theme.css` + 可选 `theme.js`，由 `plugins/theme-installer` 的宿主脚本 `ui/theme-host.js` 装载）。
> 我方现状：`qq-agent-ui-next`（`E:\QQ Agent Dev\qq-agent-ui-next`）＝ 重写外壳 + 改过逻辑层的**整套前端**，装到 `resources/app/ui-next/`，并改 `electron/main.js`、`src/app.js`。
> 结论口径：**"能不能移"分两条线看** —— 移"MC 外观"（可以，官方路线）；移"整套新 UI"（技术上可以，但代价与冲突很大）。

---

## 一、结论速览

| 路线 | 做什么 | 可行性 | 代价 | 推荐度 |
|---|---|---|---|---|
| **A 主题包** | 把 MC 皮肤做成 `themes/minecraft/`（theme.css + theme.js + assets） | ✅ 高（外观/字体/背景/音效/像素图标都能到） | 需要**按对方 DOM 重写**，不是拷贝；约 1–2 天 | ⭐ 推荐 |
| **B 整套新 UI** | 把 `app/ui`（71 文件 19MB）+ `electron/main.js` + `preload.cjs` + `src/app.js` 补丁搬过去 | ⚠️ 中（版本/接口匹配才行） | 顶掉对方的主题系统与「主题」页；对方升级即全丢；无法用他们的装载/卸载/市场链路 | 仅在对方愿意当"独立分支"维护时 |
| **C 混合** | B + 在我们 `index.html` 里补回 `<!-- theme-host:begin -->` 标记块与令牌别名，让对方的主题系统继续活 | ⚠️ 中高（要做兼容层） | 工作量最大，但唯一"两全"形态 | 备选 |

一句话：**"我要把 MC 主题给他"→ 走 A，成功率高；"我要把我这整套新控制台给他"→ 走 B/C，等于让他换一套前端并放弃主题市场。**

---

## 二、两边机制的根本差异（为什么不能直接拷贝）

| 维度 | 我们的 `ui-next` | 对方的主题包 |
|---|---|---|
| 交付单元 | 一整个前端目录 + 改 3 个应用文件 | 一个文件夹 `ui/themes/<id>/` |
| 能否改 `ui/index.html` | **我们重写了**（32KB 新壳） | 明令禁止（改会被插件摘掉/冲突） |
| 能否改 `ui/app/*.js` | **我们改了**（新增 13-dashboard / 14-theme-section，00-core、06-settings-render 也动过） | 明令禁止 |
| 能否改窗口形态 | 无边框 + 自绘标题栏（`electron/main.js` + `preload.cjs`） | **完全碰不到**（插件/主题都没有主进程钩子） |
| 生效方式 | 重启 QQ Agent | 「主题」页点「刷新/应用」，热切换、可卸载 |
| 应用升级后 | `resources/app/` 整棵被替换 → 一起消失 | 文档 §3.5 同样会消失，但官方给了"拷回 + 重装接口"的路径 |
| CSS 令牌 | `--q-*` / `--s-*`（DSH 体系，见 `styles/00-tokens.css`） | `--bg0..--bg3 / --tx,--tx2,--tx3 / --ac / --bd,--bd2` |
| 新增页面 | dashboard / 主题卡页 / 个性化页 | 主题只能在既有 DOM 上"包"分组与面板 |

**判据**：对方文档第 10 章"不要改应用源码"和我们的做法（改 `index.html` + 逻辑层 + 主进程）**正好相反**。所以"整套 UI"不可能以主题身份交付，只能以"替换应用文件"交付。

---

## 三、可移植度逐项判决（我们 → 对方）

| 我们的东西 | 能否移植 | 怎么移 | 成本 | 依据 / 坑 |
|---|---|---|---|---|
| `assets/mc/**`（字体、背景、音效） | ✅ 100% | 原样进 `assets/` | 极低 | 体积：22 文件 / 解压 **16.32MB** / **zip 3.5MB**，全部达标（红线 300 / 64MB / 24MB） |
| MC 调色板（亮=石头 GUI、暗=洞穴） | ✅ | 值照搬，**改令牌名** `--q-bg-base→--bg0`、`--q-bg-1→--bg1`、`--q-bg-2→--bg2`、`--q-bg-3→--bg3`、`--q-fg→--tx`、`--q-fg-2→--tx2`、`--q-fg-3→--tx3`、`--q-accent→--ac`、`--q-line-1→--bd`、`--q-line-2→--bd2` | 低 | 必须**亮暗两块都写**（文档 §8.5：只写暗色，用户切亮色会瞎） |
| 像素风：圆角归零 + 内阴影立体边框 | ✅ | 我们写的是 `html[data-skin='minecraft'] .btn / input / .setcard`；对方删掉 `[data-skin]` 前缀即可，容器类换成他们的 `.mcard / .list-pane / button` | 低 | 我们的选择器里混了自有类（`.dash-card`、`.setcard`、`.market-card`），要换名 |
| **拉杆开关** | ✅ **最大红利** | 我们是纯 CSS 作用于 `input[type=checkbox]`（`appearance:none` + `::before/::after`）。对方设置页正好由 `06-settings-render.js` 动态渲染 **22 处 `input[type=checkbox]`** | 极低 | 不动 DOM、不碰逻辑，`change/checked` 语义全保留 |
| 滑条 | ⚠️ 基本无处可施 | 同样是 `input[type=range]` 纯 CSS | 极低 | 对方老控制台里 range 只出现在**我们自己的**主题卡页；对方既有页面几乎没有滑条 → 写了也无害，但不能当卖点 |
| 输入框 / 按钮 / 面板质感 | ✅ | 同上，选择器换名 | 低 | 老控制台是 `--bg*` 令牌驱动，换令牌即可全局生效 |
| 字体（拉丁 + 汉字双字体分工） | ✅ | `@font-face` 的 url 必须从 `/assets/mc/fonts/...` 改成**相对 css 的 `assets/fonts/...`**（文档 §2.6 明确要求），`unicode-range` 分工原样保留 | 低 | 15.4MB 中文字体虽过红线（zip 3.5MB），但首次加载靠 `font-display: swap` 顶；真要上市场仍建议裁剪到 1–2MB |
| 背景图 + 透明度 | ✅ | 逻辑照搬：CSS 变量 `--mc-bg-image` 由脚本写入，承载层换对方的 `#layout`（对方 DOM 里就有 `#layout`，文档 §8.3 也在用它） | 中 | 必须把对方原本不透明的面（`--bg1/--bg2`）改成半透明，否则图被盖住（我们踩过这一条） |
| 音效（13 → 现有 10 个 wav） | ✅ | `theme.js` 里 `Audio` + **事件委托**；偏好自存 localStorage | 中 | ① 浏览器自动播放策略：首个用户手势前播不了；② 对方列表是整块 `innerHTML` 重绘 → 必须委托（文档 §9.2 也是这个要求） |
| 像素图标集（16×16 矩形配方） | ✅ 配方可留，**挂载要重写** | 对方 `#tabs` 是 **9 个纯文字 `<button class="tab">`**（无 `data-icon`、无 svg、无 `.tab-ico`）；我们的是 `<button data-icon>` + `.tab-ico` | 中 | 矩形数据 (`NAV`) 能原样搬；改为"给每个 `.tab` 塞一个自己造的 `<canvas>/<svg>`"，按 `data-tab` 名映射（我们原来的 key 是 gauge/chat/archive…，要重新对照） |
| 无边框窗口 / 自绘标题栏 | ❌ | 需要改 `electron/main.js` + `preload.cjs` | — | 主题机制在渲染进程，主进程够不着 → 这是 A 路线唯一的"看得见的损失" |
| dashboard 页 | ❌（作为主题） | 需要新视图 + 改 `index.html` + 数据接口 | 高 | 硬造：`theme.js` 自己建 DOM 并 fetch `/api/*` 理论可行，但等于重写而不是移植 |
| 设置里的「主题卡页」（皮肤卡/亮度档/二级字段） | ❌（作为主题） | 需要改 `06-settings-render.js`/`14-theme-section.js` | — | 而且对方已有自己的「主题」页（theme-host 注入），两边语义会打架 |
| 逻辑层补丁（`00-core`/`06`/`13`/`14` 等） | ❌ | 需要覆盖 `ui/app/*.js` | — | 这正是文档第 10 章禁止的事 |
| 亮 / 暗两档直接翻转 | ✅ | 主题包天然就有 `data-theme` 两套令牌 | 低 | 我们的 `data-skin` 维度**不需要**搬：在对方那里"MC"本身就是选中的那个主题，皮肤维度退化成"装了没装" |

**净结论**：MC 主题中"像素风外观、字体、背景、音效、像素图标、拉杆开关"六成到八成可以到位；"新壳布局、仪表盘、主题卡页、无边框标题栏"四样进不了主题包。

---

## 四、路线 A 细节（推荐）

### 交付物

```
minecraft/
├── theme.json          # format 2 / id / name / version / author / description / license / css
│                       # js + hasScript:true + scriptNote（有脚本必须声明）
├── theme.css           # 令牌 + 像素风覆盖（选择器按对方 DOM 重写）
├── theme.js            # 背景图 / 音效 / 像素图标（幂等 + guard + 事件委托）
├── preview.png         # 现成：shots/final/mc-theme.png（111KB，≤2MB 达标）
└── assets/
    ├── fonts/{minecraft-latin.ttf, minecraft-ae.ttf}
    ├── bg/*.png
    ├── sfx/*.wav
    └── NOTICE + LICENSE-ARTWORK   # 授权声明（见风险 ③）
```

### 必须做的四件事

1. **路径改造**：所有 `/assets/mc/...` → 相对路径（css 里 `url("assets/...")`；js 里按 `document.currentScript.src` 推 base，文档 §2.6 给了模板）。
2. **令牌映射**：按第三节的对照表把 `--q-*` 值翻成 `--bg0..--bd2`，亮暗各一套；能删的 `--q-*` 私有令牌自己定义在 `:root` 里用。
3. **选择器换名**：`html[data-skin='minecraft'] X` → 直接 `X`；`X` 里的自有类（`.q-main`/`.dash-*`/`.setcard`/`.market-card`）换成对方的容器类。
4. **脚本骨架照文档 §5.2/§7**：先全注册观察器再逐个 `guard` 装饰、`decorateExclusively` 防自触发、幂等判断看 DOM 产物而不是 `dataset`、同步装饰不 debounce。

### 本机预演方案（不需要对方任何文件）

对方主题的落点就是**老控制台**，而老控制台我们本机有完整一份（`E:\QQ Agent\resources\app\ui`，令牌名与文档 §1.3 完全一致）：

```powershell
cd 'E:\QQ Agent Dev\qq-agent-ui-next'
node tools/dev-server.mjs --port 3401 --ui 'E:\QQ Agent\resources\app\ui'   # 用老控制台当靶子
# 手工在页面里注入主题包（模拟 theme-host）：<link href="/themes/minecraft/theme.css">
#                                                <script defer src="/themes/minecraft/theme.js">
node tools/cdp.mjs   # 现成的 CDP 探针/截图/断言基础设施
```

再按文档 §11.1 的"必须覆盖的断言"逐条过（主题已加载 / `__themeErr` 为 null / 模糊元素个位数 / 滚动容器无 mask / 每个装饰区有产物 / 交互往返 / 页签各走一遍）。**这能把 A 路线的风险压到只剩"对方 DOM 与我方老控制台有版本差"这一条。**

### 风险

| # | 风险 | 应对 |
|---|---|---|
| ① | 我们这边**没有** `plugins/theme-installer` / `ui/themes/` / `ui/theme-host.js`（本机 0.4.0 实测没有）→ 没法真正"装上去"验证装载链路 | 去我方控制台「插件」页看有没有「主题接口 / theme-installer」可装；没有就向对方要一份插件目录 |
| ② | 对方的 0.4.x 构建比我们的老控制台新（他们带 theme-host）→ 类名/结构可能有差 | 要对方一份 `ui/index.html` + `ui/style.css`（或整个 `resources/app`），做一次 diff |
| ③ | **授权**：MC 的字体与音效/素材是 Mojang 的，不是 CC；文档 §14 要求署名链与"不能商用"，多数市场要求可商用授权 | 先确认对方只是自用分享还是要上市场；上市场很可能被拒（这是比技术更硬的一道墙） |
| ④ | 15.4MB 中文字体首次加载慢 | 已在待办里：按常用字集裁剪到 1–2MB 再打包 |
| ⑤ | 主题脚本能读会话数据（文档 §4.4 明说） | `scriptNote` 写清楚只做本地音效/背景/图标，不发网络请求（CSP 也拦外域 fetch） |

---

## 五、路线 B 细节（整套新 UI 搬过去）

要搬的东西（`docs/deploy-and-rollback.md` 的清单）：

- `app/ui`（71 文件 / 19MB，含 16MB 字体）
- `app/electron/main.js`（无边框窗口 + 自绘标题栏 IPC + `QQ_AGENT_UI_DIR` 默认值）
- `app/electron/preload.cjs`（窗口控制桥）
- `resources/app/src/app.js` 的 `QQ_AGENT_UI_DIR` 补丁（或干脆覆盖对方 `ui/`）

**顶掉的后果**：

1. 对方的「主题」页靠 `theme-host.js` 按 `<!-- theme-host:begin/end -->` 标记块往 `ui/index.html` 里塞 `<link>/<script>`；我们的 `index.html` 没有这些标记 → **他们的主题系统与主题市场全部失效**（装了也看不到、点了没反应）。
2. 主题包本来能"装了不重启、卸载可回收"（`.recycle/`），换成我们的 UI 后这套生命周期管理全丢。
3. `resources/app/` 被应用升级整棵替换 → 我们的 UI 与对方已装的主题一起消失，回滚只能靠手工备份（我们的 `apply-ui.mjs` 是"我方仓库内可回滚"，不解决他机器上的升级）。

**适合做的唯一场景**：对方明确说"我就要你这套控制台，以后我自己维护"，并且你能拿到他的 `resources/app` 做一次接口对齐（我们逻辑层调 `/api/*`，后端版本不一样会 404）。

---

## 六、路线 C（B 的稳妥形态）

在 B 的基础上补三件事，让对方的主题系统继续可用：

1. 在我们 `index.html` 里留 `<!-- theme-host:begin --> … <!-- theme-host:end -->` 标记块（给 `theme-host.js` 摘挂）；
2. `index.html` 的 CSP 放行对方的 `connect-src` 白名单，并允许 theme-host 注入的 `<link>/<script>`（`script-src 'self'` 已够）；
3. 我们的 CSS 里把对方的 `--bg0..--bd2` 做一组别名映射到 `--q-*`，这样**对方市场上任何主题**都能在我们新壳上生效（等于顺手把新 UI 变成"主题兼容壳"）。

这条做完，收益是"新 UI + 对方整个主题生态"，成本是兼容层与回归测试。

---

## 七、下一步需要的信息

**向对方要**：
1. `resources/app/ui/index.html`（或整份 `resources/app`，最省事）；
2. `ui/style.css` 里的 `:root` / `[data-theme='light']` 两块（核对令牌是否与文档一致）；
3. 他们的 QQ Agent 版本号 + 是否愿意让我们也拿一份 `plugins/theme-installer`（这样我方本机就能真装真卸地验）。

**我方可以先做（不依赖对方）**：
- 把 MC 皮肤从 `ui-next` 里"抽"成可独立测试的主题包骨架（`theme.css` / `theme.js` / `theme.json` / `assets/`），在老控制台上预演；
- 写一个"主题包红线自检"脚本（zip ≤24MB、解压 ≤64MB、≤300 文件、禁用后缀、`hasScript/scriptNote` 一致、`preview.*` ≤2MB），替代对方 `theme-package.js --selftest` 的本地校验；
- 决定授权口径（自用分享 / 上市场），这直接决定字体与音效能不能随包发。

---

## 八、附：本机核对证据（2026-10-05）

| 事实 | 实测值 |
|---|---|
| 我方安装版本 | `E:\QQ Agent\resources\app\package.json` → `qq-agent` **0.4.0**（作者 Kondius；上游公开仓库最新 release 为 v0.3.0） |
| 主题机制是否在我方安装里 | `ui/themes` ❌、`ui/theme-host.js` ❌、`plugins/theme-installer` ❌ |
| 对方主题的落点 DOM | 老控制台 `resources/app/ui/index.html`：`#tabs`(9 个 `.tab` 纯文字)、`#topbar`、`#layout`、3 处 `.list-pane`、`#view-*` 齐全；`data-icon` 0 处 |
| 令牌一致性 | 老控制台 `style.css` 定义 `--bg0/--bg1/--bg2/--bg3/--tx/--tx2/--tx3/--ac/--bd/--bd2`（另有 `--ok/--warn/--err` 系）→ 与对方文档 §1.3 完全一致，含"旧别名 `--bg/--text/--muted/--accent`" |
| 开关形态 | 老控制台 `input[type=checkbox]`：`06-settings-render.js` 22 处、`08-modals.js` 4 处、`09-community.js` 2 处、`10-feedback.js` 2 处、`04-archive-usage.js` 2 处；`input[type=range]` 0 处 |
| MC 素材体积 | 22 文件 / 解压 **16.32 MB** / zip（Optimal）**3.50 MB** → 红线 300 文件、64MB、24MB 全部通过 |
| MC 主题源码体积 | `styles/32-theme.css` 26.9KB（其中 50 处 `data-skin`，84 个顶层选择器里 36 个带 `data-skin`）+ `shell/01-skin.js` 5.6KB + `02-mc-theme.js` 20.4KB + `03-mc-icons.js` 11.2KB |
