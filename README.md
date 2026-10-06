# qq-agent-ui-next —— QQ Agent 新控制台（移交文档入口）

> 当前工作区：`E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next`。
> 本地 UI 基线：**0.4.0（未发布）**；目标 GitHub 仓库：**QQARCFOX（私有）**。
> 本次接手结果与版本流程见 [`docs/CODEX-MIGRATION.md`](docs/CODEX-MIGRATION.md)。

酒狐最新完整资源已收录在 `Wine_Fox/`，后续将作为主题互动宠物。
接入与实测性能见 [`docs/WINE-FOX-INTEGRATION.md`](docs/WINE-FOX-INTEGRATION.md)。
当前主界面尚未注册新宠物；独立参考页可运行 `node Wine_Fox/WebPet/server.mjs`。

> 这个目录是 **QQ Agent 前端的一次完整重写**：新外壳（无边框窗口 + 自绘标题栏 + 新侧栏/仪表盘）
> ＋ 一套 Minecraft 像素风皮肤（配色 / 字体 / 音效 / 背景图 / 像素图标 / 拉杆开关）。
>
> 它**不是**一个独立应用，而是被装进 `E:\QQ Agent\resources\app\ui-next\` 后由 QQ Agent 伺服的整套前端。
> 老控制台 `resources\app\ui\` **原封不动保留**，随时可回退。

**接手前请先读 [`docs/HANDOFF-WILL.md`](docs/HANDOFF-WILL.md)** —— 那份记录了这个项目的"硬约束"
（用户明确提过的要求、已经踩过并写进注释的坑、被否决过的做法）。读完它再动代码，能省掉大量返工。

---

## 一分钟上手

```powershell
cd 'E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next'

# 改完任何 app/ui/ 下的文件后，按这个顺序落地（少一步都不生效）
node tools/csp-hash.mjs --write                     # 1. 重算内联脚本 hash，三处同步
node tools/apply-ui.mjs --apply             # 2. 工作区 app/ui/ → 安装目录 ui-next/（自动备份上一版）
node tools/restore-plugin-inject.mjs        # 3. 补回托管插件被镜像冲掉的注入（见"关键坐标"下方说明）
node tools/restart-agent.mjs --apply        # 4. 重启 QQ Agent 并验证新 UI 真的上来了
Start-Sleep -Seconds 13                     # 5. 等它就绪，再做浏览器侧验证

# 全量回归（42 套件，约 10 分钟；应用全程必须在线）
node tools/run-all-checks.mjs 'http://127.0.0.1:3210/'
```

**为什么是这五步**：`app/ui/index.html` 里那段"主题预置"必须是**内联脚本**（外链会晚一帧执行 → 首屏闪白），
而 CSP 只放行**精确的 sha256**（不用 `unsafe-inline`）。所以那段脚本的 hash 是一个**契约**，
必须同时存在于 `index.html` 的 meta、`src/app.js` 下发的 HTTP 头、`tools/dev-server.mjs` 三处 ——
`csp-hash.mjs` 就是干这个的。改完不跑它，页面会因为 CSP 拒绝执行而**静默丢掉主题预置**。
第 3 步的理由见下一节（托管插件注入）。

---

## 关键坐标

| 项 | 值 |
|---|---|
| 工作区（本项目） | `E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next` |
| 部署目标 | `E:\QQ Agent\resources\app\ui-next\` |
| 老控制台（回退用，勿动） | `E:\QQ Agent\resources\app\ui\` |
| 应用 URL | `http://127.0.0.1:3210/` |
| 用户素材原始目录 | `E:\CodeX-YSM\QQ Agent Dev\UI\（该历史目录当前不存在；打包素材见 app/ui/assets/mc）` |
| 备份目录 | `_backup\ui-next-<时间戳>\`（`apply-ui` 每次自动生成） |
| 目录选择逻辑 | `electron/main.js` 的 `applyUiDirDefault()`：环境变量 `QQ_AGENT_UI_DIR` > `ui-next/index.html` 存在 > 回落 `ui/` |

> ⚠️ `resources\app\src\app.js` 的静态服务器 MIME 表**原本没有 `.mjs`**，会让
> `import('/assets/xxx.mjs')` 报 "Failed to fetch dynamically imported module"，
> 而 `fetch()` 同一个 URL 却是 200 —— 只看网络面板看不出来。
> 修法是 `node tools/patch-host-mime.mjs`（幂等）。
> **重装 QQ Agent 后必须再跑一次**，因为那个文件会被覆盖回原样。

### ⚠️ 部署目录里有两样东西**不属于本项目**

`ui-next/` 是整目录镜像，但托管插件会往里注入自己的文件。当前有两处：

| 文件 | 来源 | 说明 |
|---|---|---|
| `theme-switcher.js` | `plugins/theme-mode` 注入 | 由插件写进部署的 `index.html`：`<script defer src="/theme-switcher.js">` |
| `theme-mode-status.json` | 同上 | 插件自检产出的状态文件 |

**两件必须知道的事**：

1. **`apply-ui --apply` 会把那行注入冲掉**（工作区的 `index.html` 里没有它，也不该有 ——
   注入由插件自己拥有）。插件下次自检会重新注入，但**时机不可控**，
   所以部署流程里加了第 3 步补回来：

   ```powershell
   node tools/restore-plugin-inject.mjs          # 幂等；只写部署目录，不碰工作区
   node tools/restore-plugin-inject.mjs --dry-run # 只看会做什么
   ```

   守主：`node tools/check-plugin-inject.mjs`（回归里也有这一套；环境不具备时自动跳过）。
2. **该注入在新 UI 下是"无操作"**：`theme-switcher.js` 只在 `.skill-modal`（技能弹窗，
   且标识含 `theme-mode`）里注入 UI，而新 UI 没有这个宿主 ——
   所以它加载成功、200、控制台干净，但**不会产生任何可见变化**。
   这不是坏了，是没有宿主；别去"修"它。

---

## 文档地图

| 文档 | 什么时候看 |
|---|---|
| [`docs/HANDOFF-WILL.md`](docs/HANDOFF-WILL.md) | **动手前必读**。需求全貌、硬约束、被否决的做法、需用户拍板的前置条件 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 要改结构：外壳/主题体系/令牌/CSS 加载顺序 |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | 日常开发：部署四步、工具清单、调试手段 |
| [`docs/TESTING.md`](docs/TESTING.md) | 跑/写验收：42 套件分布、CDP 测试怎么写、断言纪律 |
| [`docs/PITFALLS.md`](docs/PITFALLS.md) | 踩坑速查（含症状 → 根因 → 修法），出怪问题时先翻这里 |
| [`docs/THEME-SYSTEM.md`](docs/THEME-SYSTEM.md) | 改主题/皮肤：令牌表、skin × 亮度、MC 字体/音效/背景/图标/拉杆 |
| [`docs/design-notes.md`](docs/design-notes.md) | 完整编年史（2301 行）。想查"某件事为什么这么做" |
| [`docs/deploy-and-rollback.md`](docs/deploy-and-rollback.md) | 切换与回退的原始说明（历史文档，仍准确） |
| [`docs/dom-contract.md`](docs/dom-contract.md) | 自动生成的选择器契约（`node tools/extract-dom-contract.mjs` 重生成） |
| [`docs/electron-shell.md`](docs/electron-shell.md) | 无边框外壳的交付记录与验证口径 |
| [`docs/theme-port-feasibility.md`](docs/theme-port-feasibility.md) | 要把这套 UI / MC 主题移植给**别人的** QQ Agent 时看 |

---

## 现状一句话

- 前端 **70 个文件 / 18.1 MB**（其中 MC 中文像素字体 15.4 MB、MC 背景图 5 张）
- 回归 **42 套件**（移交记录为全绿；本次迁移时宿主离线，在线回归尚未复验）（`node tools/run-all-checks.mjs`，约 10 分钟）
- MC 皮肤与默认皮肤**正交**：`<html data-skin="default|minecraft">` × `<html data-theme="light|dark">`
- 亮度是**两档**（亮/暗），没有"跟随系统"入口 —— 这是用户明确要求过的

> 遗留事项：`docs/HANDOFF-WILL.md` 末尾的"待办与未决"。那是唯一需要向用户确认的清单。
