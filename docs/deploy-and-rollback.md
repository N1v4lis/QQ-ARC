# 新 UI 落地与回退（2026-10-03）

本文只讲**怎么切、怎么退**。设计与实现说明见 `docs/design-notes.md`。

## 目录约定（安装目录 `E:\QQ Agent\resources\app\`）

| 路径 | 内容 | 谁在用 |
|---|---|---|
| `ui/` | 老控制台（**原封不动保留**） | 回退用 |
| `ui-next/` | 新 UI（工作区 `app/ui/` 的镜像） | 重启后默认使用 |
| `src/app.js` | 新增 `QQ_AGENT_UI_DIR`：决定伺服哪个前端目录 | — |
| `electron/main.js` | 无边框窗口 + 自绘标题栏 IPC + 前端目录默认值 | — |

三个文件是这套东西的"开关"，改任何一个都要重启才生效：
`src/app.js`（伺服目录逻辑）、`electron/main.js`（窗口形态 + 默认值）、`electron/preload.cjs`（窗口控制桥）。

## 切换（部署新 UI）

```powershell
cd 'E:\QQ Agent Dev\qq-agent-ui-next'

# 1) 把新 UI 与外壳装到安装目录（自动备份上一版 ui-next，可回滚）
node tools/apply-ui.mjs --apply
Copy-Item app\electron\main.js    'E:\QQ Agent\resources\app\electron\main.js' -Force
Copy-Item app\electron\preload.cjs 'E:\QQ Agent\resources\app\electron\preload.cjs' -Force

# 2) 重启（会给窗口发关闭消息 → 树杀 → 等干净 → 启动 → 校验返回的是新 UI）
node tools/restart-agent.mjs --apply
```

`restart-agent.mjs` 的校验项：进程真的全退（否则新实例会被单实例锁挡掉）、
HTTP 起来、返回的 HTML 含 `q-titlebar`（确实是新 UI）、`/api/status` 可用。

## 回退（任一路径都能独立完成）

| 想退到什么程度 | 操作 |
|---|---|
| 只退 UI，保留无边框窗口 | 删掉 `E:\QQ Agent\resources\app\ui-next` 整个目录 → 重启。`electron/main.js` 探测不到 `ui-next/index.html` 会**自动回落**老控制台 |
| 退到上一次的 ui-next | `node tools/apply-ui.mjs --list` 看时间戳 → `node tools/apply-ui.mjs --rollback <时间戳>` → 重启 |
| 连窗口形态一起退 | `node tools/apply-electron.mjs --rollback 20261003-221632`（见 `docs/electron-shell.md`）→ 重启 |
| 只临时对照（不重启） | `QQ_AGENT_UI_DIR` 环境变量指到任意前端目录再启动 |

## 验收清单（每次改完 UI 都该跑一遍）

```powershell
cd 'E:\QQ Agent Dev\qq-agent-ui-next'

# 起两个本地伺服：3400 = 工作区新 UI，3401 = 老控制台（对照用）
node tools/dev-server.mjs --port 3400                                  # 工作区 app/ui
node tools/dev-server.mjs --port 3401 --ui 'E:\QQ Agent\resources\app\ui'   # 老控制台

node tools/check-dom-contract.mjs              # 移植逻辑要用的选择器是否都在
node tools/compare-baseline.mjs --base http://127.0.0.1:3401/ --next http://127.0.0.1:3400/
node tools/check-styles.mjs                    # 22 条计算样式断言（防旧皮肤盖住新样式）
node tools/check-motion.mjs                    # 12 条动效断言（过渡/交叉淡出/弹窗）
node tools/check-theme.mjs                     # 11 条三档主题断言（含"跟随系统"）
node tools/csp-hash.mjs                        # 内联脚本 hash 与 CSP 是否一致
node tools/inventory-classes.mjs               # 还有哪些 class 没有任何样式来源
```

## 已经踩过、别再踩的坑

1. **`@layer` 方向和直觉相反**：未分层样式 > 任何分层样式。所以"旧皮肤放低层、新样式留默认层"
   会变成旧皮肤永远赢。必须用 `@import url() layer(legacy)` 把整张旧皮肤放进层里
   （见 `styles/99-legacy-layer.css`）。症状极隐蔽：新规则明明写在后面却不生效。
2. **CSP 内联脚本 hash 与换行符相关**：`index.html` 是 CRLF，按 LF 算 hash 永远对不上，
   而失败时浏览器只打一条警告、页面照常显示。`tools/csp-hash.mjs` 会把两种换行形态的
   hash 都写进 allowlist，并用 `tools/check-theme.mjs` 做运行时验证。
3. **无头浏览器默认 `prefers-reduced-motion: reduce`**：样式表里那条"尊重减弱动态效果"的
   兜底会把所有过渡压到 0.001ms，于是"动效"这件事会被整片误判。
   `tools/cdp.mjs` 已默认强制 `no-preference`。
4. **视口宽度会改变结论**：< 880px 会命中侧栏的窄窗口媒体查询（文字隐藏、居中）。
   断言工具固定用 1600×900，别用 1200。
5. **`#tabs` / `#topbar` 是旧皮肤里未分层的 ID 选择器**：新版规则涉及这两个容器时必须自带 ID 前缀，
   或依赖 `layer(legacy)` 已经把它压下去。
6. **`.q-side-foot` 是 `#tabs` 的兄弟，不是后代**：选择器写 `#tabs.q-side .q-side-foot …` 永远不匹配。

## 版本同步（0.4.5起）

工作区 VERSION 为 UI 与本机客户端的统一版本来源。每次 `node tools/apply-ui.mjs --apply` 校验成功后自动执行 `patch-host-version.mjs`，备份并更新安装目录的 package.json；重启后宿主版本接口及客户端读取新版本。预演和 UI 回滚不改客户端版本，回滚完整发布时需同步回滚 VERSION 后执行版本补丁并重启。EXE 安装包文件属性不随源码部署重打包。此机制不自动推送 GitHub。
