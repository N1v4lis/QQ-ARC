# 开发工作流

> 2026-10-08最新验证要求：用户停用后续56项完整酒狐互动检查。默认仅四项静态检查，酒狐按本次改动定点验证；完整脚本仅明确要求后手动运行，发布不恢复。此要求覆盖下文历史流程，见[当前规则](REGRESSION-WORKFLOW.md)。


> 用户最新范围：自动回归仅原编号1、2、3、5、30，默认5项core；文档/工具用4项static；其他38套停用，发布不自动恢复。旧quick/full均映射core。见 [REGRESSION-WORKFLOW.md](REGRESSION-WORKFLOW.md)。

> ARCFØX：当前部署89个UI文件，冷启动4秒、刷新2.6秒、画布16:9。预览 http://127.0.0.1:3400/startup-preview.html；只做改动所需的定点观察，不自动调用已停用的启动专项。首次部署/宿主重装执行 `node tools/patch-host-qq-detection.mjs` 并重启，将宿主已有QQ进程扫描摘要暴露给冷启动进度；不增加查询。实现 [STARTUP-ANIMATION.md](STARTUP-ANIMATION.md)。

> 0.4.01 新工具：node tools/prepare-wine-fox.mjs 生成最小运行资产；node tools/check-wine-fox.mjs http://127.0.0.1:3210/ 验收宠物；真机检查先 node tools/restart-agent.mjs --apply --cdp-port 9224，再 node tools/verify-wine-fox-electron.mjs。完成后用普通 restart-agent --apply 重启结束调试。部署 app/ui 共81文件（约26.88 MiB），当前工具79文件；旧统计为历史。

---

## 一、改一行代码之后的四步（少一步都不生效）

```powershell
cd 'E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next'

node tools/csp-hash.mjs --write               # ① 重算内联脚本 hash（三处同步）
node tools/apply-ui.mjs --apply       # ② 工作区 app/ui/ → 安装目录 ui-next/（自动备份）
node tools/restore-plugin-inject.mjs  # ③ 补回托管插件被镜像冲掉的注入（见下方 ⚠️）
node tools/restart-agent.mjs --apply  # ④ 重启并**验证**新 UI 真的上来了
Start-Sleep -Seconds 13               # ⑤ 等就绪，再做浏览器侧验证
```

### 为什么每步都不能省

**① `csp-hash.mjs`**
`index.html` 里那段"主题预置"必须是**内联脚本**（外链会晚一帧执行 → 首屏闪白），
而 CSP **只放行精确的 sha256**（不用 `'unsafe-inline'`，否则任何 `innerHTML` 注入都能执行内联代码）。
于是这段脚本的 hash 是个**契约**，必须同时存在于三处：

| 位置 | 作用 |
|---|---|
| `app/ui/index.html` 的 CSP meta | 页面自身 |
| `resources/app/src/app.js` 下发的 HTTP 头 | 服务端覆盖（**工作区 + 安装目录两份**） |
| `tools/dev-server.mjs` | 本地开发同口径 |

漏掉任何一处，那段脚本会被**静默拒绝执行** —— 症状是"主题预置好像没生效"，
而控制台只有一条 CSP 报错，很容易被忽略。

**② `apply-ui.mjs --apply`**
只写 `ui-next/`，**从不碰 `ui/`**。覆盖前把上一版备份到 `_backup/ui-next-<时间戳>/`，
所以随时能 `node tools/apply-ui.mjs --rollback <时间戳>`。
> 注意：它是**整目录镜像**。你工作区里留下的临时文件（比如 `*.bak-xxx`）也会被一起拷进部署目录 ——
> 我踩过一次，发布物里混进了自己的备份文件。改完记得清干净。
>
> ⚠️ 镜像还有一个**反向**后果：托管插件注入到部署 `index.html` 里的东西会被冲掉。
> 当前 `plugins/theme-mode` 注入了 `<script defer src="/theme-switcher.js"></script>`，
> 而工作区没有这一行（也不该有 —— 注入由插件拥有，抄进源码反而是错的）。
> 所以**每次部署都会移除它**，插件下次自检会补回来。
> 验证与完整说明：`node tools/check-plugin-inject.mjs`（回归里也有这一套）。

**③ `restart-agent.mjs --apply`**
不能直接在会话里 `taskkill`：关不干净会让新实例被**单实例锁**挡掉，表现为"双击没反应"、
而日志里什么都没有（`main.js` 拿不到锁就静默 quit）。
这个脚本做三件事：给它机会刷盘 → 杀干净并**逐秒复核进程真的没了** → 起来后**验证**
（端口在听、返回的 HTML 含 `q-titlebar`、`/api/status` 正常）。不验证的重启等于没重启。

**④ 等 13 秒**
Electron 冷启动 + 配置拉取需要时间。急着连 CDP 会撞上"页面还没起来"，
然后被误判成"功能坏了"。

---

## 二、日常开发的另一种方式：开发服务器

不想每次都重启应用时用 `dev-server.mjs`：

```powershell
node tools/dev-server.mjs --port 3400
# 打开 http://127.0.0.1:3400/
```

它从**工作区**静态伺服 `app/ui/`，把 `/api/*` 转发到正在跑的 `:3210`。
于是你改的是工作区文件、拿到的是**真实数据**，而用户正在用的界面一个字节都不动。

> ⚠️ 只有两件事在 dev-server 下测不出来：
> ① 无边框窗口/自绘标题栏（那属于 Electron 主进程）；
> ② CSP 头（dev-server 有自己的一份口径，真机是 `src/app.js` 下发的）。
> 这两类必须走 §一 的四步在真机上验。

---

## 三、工具清单（`tools/`，74 个）

### 部署类（改完必用）

| 工具 | 用途 |
|---|---|
| `csp-hash.mjs` | 重算并同步内联脚本 hash（见 §一） |
| `restore-plugin-inject.mjs` | 补回托管插件往部署界面注入的 script 行与前端文件（`--dry-run` 可预演）。**幂等；只写部署目录** |
| `apply-ui.mjs [--apply\|--rollback <ts>]` | 工作区 → `ui-next/`；自动备份；可回滚 |
| `restart-agent.mjs [--apply\|--status]` | 杀干净 → 启动 → 验证 |
| `patch-host-mime.mjs` | 给宿主静态服务器补 `.mjs / .ttf / .otf / .woff* / .wav` MIME。**幂等；重装 QQ Agent 后必须重跑** |
| `apply-electron.mjs [--rollback]` | 装无边框外壳（备份 → 安装 → 回读校验 → 失败自动还原） |
| `dev-server.mjs` | 工作区伺服 + `/api/*` 转发（见 §二） |

### 回归与验收

| 工具 | 用途 |
|---|---|
| `run-all-checks.mjs [url]` | 42 套件全量回归；失败套件的所有 `✗` 会打到 `shots/final/regression-failures.txt` |
| `check-*.mjs`（50 个） | 单个验收套件，见 `TESTING.md` |
| `cdp.mjs` | 极简 CDP 客户端（Node 内置 WebSocket，**无 puppeteer/playwright 依赖**）。所有 `check-*` / `shoot-*` 都 import 它 |
| `verify-electron.mjs` | 无边框外壳验证（91 断言，用 Electron 桩跑真代码，**不碰进程**） |

### 取证与排查

| 工具 | 用途 |
|---|---|
| `shoot.mjs` | 各页签截图 + 关键状态快照（基线取证） |
| `shot-window.mjs` | 整窗截图（含 CSS 缩放，与用户所见一致） |
| `probe-surface-colors.mjs` | 量顶栏/侧栏/内容区的**实际计算色**（改配色前先量） |
| `probe-mc-light.mjs` | MC 亮色整窗截图 + 采样 + 统计页面上的 `.switch` 尺寸 |
| `diagnose-startup.mjs` | 启动链路诊断 |
| `which-target.mjs` | 确认当前伺服的是哪套前端目录 |
| `extract-dom-contract.mjs` | 重新生成 `docs/dom-contract.md` |
| `check-dom-contract.mjs` | 校验 DOM 契约（"原有功能仍可用"的取证） |
| `compare-baseline.mjs` | 与基线截图对比 |
| `inventory-classes.mjs` | 类名清单 |
| `check-mc-sfx.mjs` | MC 音效清单 ↔ 磁盘双向一致性校验 |

### 素材生成（低频）

| 工具 | 用途 |
|---|---|
| `gen-mc-bg.mjs` | 生成 5 张 MC 背景图（已生成过，一般不用再跑） |
| `convert-ysm-wine-fox.mjs` | 从 LegacyYSM `wine_fox` 转出酒狐资产。**当前功能已删除**，此工具**故意保留**作为恢复入口（见 `HANDOFF-WILL.md` §四） |

---

## 四、调试手段

### 看控制台报错

```powershell
# check-console.mjs 就是干这个的，也可以自己写一段 CDP
node tools/check-console.mjs 'http://127.0.0.1:3210/'
```

排查页面问题时**第一步永远是看控制台**。本项目里"功能没生效"最常见的两种原因是
**CSP 拒绝**和**模块加载失败**，两者都会在控制台留痕。

### 确认伺服的是哪套目录

```powershell
node tools/which-target.mjs
# 或直接看 HTTP 响应里是否含新外壳标记
(Invoke-WebRequest 'http://127.0.0.1:3210/' -UseBasicParsing).Content -match 'q-titlebar'
```

> 历史坑：某个主题插件把 UI 目录**写死** `path.join(ROOT,'ui')`，
> 装上去"自检通过、状态文件写出、index.html 也改了，界面却零变化" ——
> 因为它改的那个目录**根本没人看**。凡是要往界面注入东西的插件/脚本，
> 都必须跟随 `applyUiDirDefault()` 那套三级逻辑，不能写死。

### 量而不是猜

改配色/间距时**先量**再改。两个现成工具：

```powershell
node tools/probe-surface-colors.mjs 'http://127.0.0.1:3210/'   # 各"面"的实际颜色
node tools/probe-mc-light.mjs 'http://127.0.0.1:3210/' 'shots/x.png'  # 截图 + 采样 + 控件尺寸
```

---

## 五、代码约定

1. **注释写"为什么"，不写"是什么"**。这个项目的注释密度很高，是刻意的：
   很多规则看起来可以简化，但当初的约束已经不在代码里了（只在这里）。
   删注释前先确认那件事真的不再成立。
2. ⚠️ **模板字符串里的注释不能出现反引号** —— 会提前结束模板，
   `node --check` 报 `missing ) after argument list`。已在多处就地标注警告。
3. **改 JS 后必跑 `node --check <file>`**，再部署。
4. **CSS 加规则时优先用低特指度 + 明确前缀**。要覆盖组件外观（如 `.switch`）时
   记得带 `html[data-skin='minecraft']` 前缀，否则压不过 `40-market.css` 里的同名规则。
5. **写"必须不存在"的守卫测试时，清单要跟着实际存在过的东西演进** ——
   否则守卫会守着一个已经不成立的旧事实，红了也没人知道该信哪边
   （`check-fox-removed.mjs` 就经历过一次）。
