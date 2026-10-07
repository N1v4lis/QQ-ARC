# 架构

> 0.4.2增量：shell/fox-thought-canvas.mjs用单Canvas、缓存字条与静止层绘制最多512个屏幕气泡；shell/fox-throw.mjs负责拖拽速度、惯性衰减、撞边判定和5次点击/15秒恢复规则，生命周期由wine-fox-runtime.mjs统一控制。头顶气泡仍是CSS。

> 启动动画增量：shell/05-startup.js 在11-motion之后、app/11-init之前加载，按需导入startup-animation.mjs；styles/05-startup.css覆盖既有loading遮罩。hideLoading由控制器等待动画完成与应用就绪，bootLoop不提前移除遮罩。见 [STARTUP-ANIMATION.md](STARTUP-ANIMATION.md)。

> 0.4.01 增量：shell/04-wine-fox.js 管本地偏好与按需导入，shell/wine-fox-runtime.mjs 管 WebGL2、动画、输入及释放；styles/33-wine-fox.css 管局部宠物与设置卡；assets/wine-fox 为运行必需资产。完整 Wine_Fox 来源包位于项目根，不整体部署。

> 这份说明**结构和加载顺序**。想改外观去 `THEME-SYSTEM.md`，想查"为什么这么做"去
> `design-notes.md`，想避坑直接看 `PITFALLS.md`。

---

## 一、运行形态

```
E:\QQ Agent\resources\app\         ← QQ Agent 安装目录
├─ ui\                             老控制台（原封不动，回退用，**绝不改**）
├─ ui-next\                        本项目的部署镜像（tools/apply-ui.mjs 从工作区拷来）
├─ src\app.js                      静态服务器 + 那个 `QQ_AGENT_UI_DIR` 三级选择 + CSP 头
└─ electron\
   ├─ main.js                      frame:false 无边框窗口 + 窗口动作 IPC + 前端目录默认值
   └─ preload.cjs                  window.qqAgentShell 桥（最小化/最大化/关闭 + 状态回推）
```

页面里没有任何构建步骤：**原生 ES 模块 + 普通 `<script defer>`，CSS 直接 `<link>`**。
没有打包器、没有转译。改完文件跑 `apply-ui --apply` 就是最终产物。

---

## 二、`app/ui/` 目录职责

| 目录 | 内容 | 说明 |
|---|---|---|
| `index.html` | 外壳 DOM + CSP meta + 内联主题预置脚本 + 全部 link/script 注册 | **改注册顺序要看 §三** |
| `app/` | 逻辑层（`00-core` … `14-theme-section`），**从线上控制台原样移植** | 见 §五 的 DOM 契约纪律 |
| `shell/` | 新外壳专属运行时：主题/皮肤/MC 音效/像素图标/个性化/动效/颜色格式 | 与逻辑层分离，便于单独移植 |
| `styles/` | 分层样式表，编号即加载顺序 | 见 §四 |
| `assets/mc/` | MC 字体、音效、背景图 | 字体 15.8 MB 是体积主因 |
| `vendor/` | 两个小依赖（`price-match.js`、`tier-slider.js`） | 无 npm 依赖 |
| 其它 `*.html` | 独立子页：`landing` / `profile-manager` / 插件市场 / 技能市场 / 人设广场 | 由逻辑层按需跳转 |

### `shell/` 各模块职责

| 文件 | 职责 |
|---|---|
| `00-theme.js` | 亮度维度：`data-theme="light\|dark"`。**只有两档**（见 `HANDOFF-WILL.md` §2.1），`cycleTheme()` 直接翻转 |
| `01-skin.js` | 皮肤维度：`data-skin="default\|minecraft"`，`localStorage['qqa-skin']`，派发 `qqa-skin-change` |
| `02-mc-theme.js` | MC 偏好与音效：`localStorage['qqa-mc']`；音效加载/播放、用途分组、全局点击与 change 委托、背景图 |
| `03-mc-icons.js` | 16×16 像素网格图标 + 草方块 logo；`applyToDom(on)` 换 / 还 `dataset.orig` |
| `10-personalize.js` | 配色覆盖 |
| `11-motion.js` | 实际生效的动效开关（`html[data-motion='off']`） |
| `12-color-format.js` | 颜色格式互转工具 |
| `99-shell-boot.js` | 收尾（在 `app/11-init.js` 之后） |

**两个维度是正交的**：皮肤决定"什么风格"，亮度决定"亮还是暗"。
`data-skin` 与 `data-theme` 各自独立，组合出 4 种外观。任何新增样式都应想清"它属于哪个维度"。

---

## 三、加载顺序（改注册前必读）

### 样式（`index.html` 第 38~56 行）

```
00-tokens → 01-base → 01-motion → 02-titlebar → 03-sidebar → 04-layout
→ 20-content → 21-dashboard → 30-settings → 31-personalize
→ 32-theme        ← MC 皮肤与主题卡页；必须晚于 31（皮肤要能覆盖个性化）
→ 40-market
→ 99-legacy-layer ← 只含一条 @import，把旧皮肤放进 layer(legacy)
```

**编号 = 顺序，顺序 = 承重**。三条关键约束：

1. **`32-theme` 必须在 `31-personalize` 之后** —— 皮肤规则要能覆盖个性化之后的样式。
2. **`99-legacy-layer` 必须最后** —— 它给"没接管的角落"兜底。
3. **旧皮肤只能靠 `@import url() layer()` 装载**，不能直接 `<link>`，也不能靠
   `<link>` + 一句 `@layer legacy;`（后者只是**声明层**，不会把表放进层）。
   完整原因与症状写在 `styles/99-legacy-layer.css` 顶部 —— 那是本项目最值钱的一段注释。

> ⚠️ 旧皮肤里有一批**未分层的 ID 选择器**（`#tabs` / `#topbar` / `#layout`），
> 特指度天然高于类选择器。所以新规则在这些位置也带同样的 ID 前缀
> （见 `02-titlebar.css` / `03-sidebar.css` 的说明）。

### 脚本

```
app/00-core                      ← 必须最先：其它模块都依赖它的 $ / api / state
shell/00-theme … 12-color-format ← 外壳运行时（01-skin 必须在 03-mc-icons 之前）
app/01-boot … 14-theme-section
app/11-init                      ← 启动流程（bootLoop → 首屏 switchTab）
shell/99-shell-boot              ← 收尾
```

`shell/*` 与 `app/*` 都带 `defer`，所以**顺序即执行顺序**。
`00-core` 里的 `$()` / `$$()` / `api()` / `state` 是模块作用域，**不是 `window` 属性** ——
这一点极其重要，见 `PITFALLS.md` 的"内部函数不在全局"。

---

## 四、`styles/` 分层

| 组 | 文件 | 管什么 |
|---|---|---|
| 令牌 | `00-tokens.css` | 全部 `--q-*` 变量（默认皮肤两档） |
| 基础 | `01-base.css` / `01-motion.css` | 重置、排版、动效时长与缓动 |
| 框架 | `02-titlebar` / `03-sidebar` / `04-layout` | 顶栏、侧栏、内容布局 |
| 页面 | `20-content` / `21-dashboard` / `30-settings` / `31-personalize` | 各页样式 |
| 主题 | `32-theme.css` | MC 皮肤（配色/字体/音效控件/拉杆/背景图）与主题卡页 |
| 市场 | `40-market.css` | 市场页 + 通用组件（`.switch`、`.setcard` 在这里） |
| 兜底 | `99-legacy-layer.css` → `_legacy-style.css` | 旧皮肤，进 `layer(legacy)` |

**令牌分两处定义**：默认皮肤在 `00-tokens.css`（亮/暗各一组），
MC 皮肤在 `32-theme.css`（亮/暗各一组，同名覆盖）。
新增令牌时**两边都要给**，否则切皮肤会拿到未定义值（CSS 变量未定义时是"空"，不是"继承"）。

`tools/check-css-structure.mjs` 排在回归第一位，负责"孤儿声明 / 块闭合"这类结构问题 ——
样式表结构坏掉时，后面所有视觉断言都没有意义。

---

## 五、DOM 契约（逻辑层不可随意改）

`app/*.js` 是从线上控制台**原样移植**的逻辑层。新外壳与新版 CSS 必须让
`docs/dom-contract.md` 里每个选择器都能解析到语义相同的节点；
做不到的地方要**逐条登记**，不能默默改行为。

```powershell
node tools/extract-dom-contract.mjs > docs/dom-contract.md   # 重新生成契约
node tools/check-dom-contract.mjs                            # 校验（回归里有）
```

这条纪律换来的好处是：**"原有功能仍可用"是可验证的，不是口头保证**。
`check-markets` / `check-dom-contract` / `check-dashboard` 等套件就是它的执行者。

---

## 六、无边框外壳

需求是"不使用 Windows 自带的任务栏（关闭，最小化）"。做法：

1. `electron/main.js` 用 `frame: false` 去掉原生标题栏；
2. 页面 `.q-titlebar` 自绘，三个按钮走 `window.qqAgentShell` → IPC → `BrowserWindow.minimize()` 等；
3. 主进程把窗口状态**回推**页面（最大化图标要跟着变）。

验证口径：`node tools/verify-electron.mjs`（91 项断言，退出码 0）。
它不重启进程 —— 而是把真实字节拷进临时目录、配一套 Electron 桩模块跑真代码，
再对桩的调用记账做断言。完整交付记录见 `docs/electron-shell.md`。

---

## 七、数据流与状态

- **HTTP**：`api(path, opts)`（`00-core.js`）统一带 `x-console-token` 头 + `AbortController` 超时
  （默认 15 s）。超时是**故意**的：冷启动时后端某些接口会卡 3~6 s，
  不设超时会变成"页面永远空白且不报错"。
- **SSE**：`02-sse-sessions.js` 负责会话/状态推送。
- **配置**：`state.config` 由 `loadSettings()` 里 `Promise.all([7 个请求])` 之后赋值 ——
  **这是设置页的一个经典竞态源**，见 `PITFALLS.md`。
- **本地偏好**：`localStorage` 键 —— `qqa-skin`（皮肤）、`qqa-mc`（MC 音效/背景）、
  `qqa-theme`（亮度）、`qqa-motion` 等。新增偏好要**同时**写进 `DEFAULTS` 与读取时的
  白名单，并考虑老值迁移（MC 音效那批就做过 `note/lever/wood/stone/pistonSynth → menu` 的映射）。

## 独立人设页（2026-10-08）
主导航persona位于技能上方，设置二级菜单移除人设。唯一settings-form在view-persona与view-settings间移动，复用编辑/保存/守卫，切页先flush，保存分支按persona主路由选择。详见[实现与验证](PERSONA-PAGE.md)。
