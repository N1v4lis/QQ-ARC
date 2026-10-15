# 01 · QQAF 现状评估（三分 + 问题清单）

评估对象：`native/src/*.rs`（Rust 内核）+ `flutter/lib/*.dart`（UI）。
三分含义：**保留**（外部契约/已有夹具/真实复用，不宜动）/ **改造**（概念对但实现不理想，保留骨架重构）/ **废弃**（与目标架构冲突，或不理想来源本身）。

---

## A. Rust 内核逐模块结论

| 模块 | 结论 | 理由（锚点） |
| --- | --- | --- |
| `storage.rs` 每账号库 + `DatabasePool` 线程/队列 | **保留骨架，小改** | 每账号一 `std::thread` + 独占 `Connection` + `sync_channel(256)` + `oneshot`（`core.rs:22-92`），并发写/重开/路径逃逸有集成测试（`core_integration.rs:55-101`、`storage.rs:557`）。**问题**：`try_send` 队满即丢（返回"存储队列繁忙"，无背压等待、无告警）；无读连接池；`synchronous=FULL` + `cache_size=-2048`（`storage.rs:31-33`）。 |
| `storage.rs` schema | **改造** | 单次 `execute_batch` + `PRAGMA user_version=1`，迁移只有一句 `let _ = ALTER TABLE usage ADD COLUMN`（`storage.rs:53`）——**吞错误、无版本化迁移框架**。 |
| `migration.rs` | **改造** | 是"官方 JSON 消息一次性迁入"（`migration.rs:22-46`），不是 schema/账号迁移；可作为新迁移工具的一个子步骤复用，但不能当作迁移框架。 |
| `workspace.rs`（配置/人设/存档/文档/运行） | **改造** | 21 条路由（`workspace.rs:238-260`）。配置为整块 JSON 存 `preferences`；`merge` 深合并。可用，但与人设/群档位/白名单耦合在一处，且剥离 `personaUnified/personaShared` 的旧字段处理（`workspace.rs:300-301`）属于兼容债。 |
| `agent.rs`（1084 行，事件调度 + 工具循环） | **改造（重点）** | 单文件承担：入站判定（`recordable/permitted/triggered/effective_tier`）、每会话队列与唤醒、工具循环、发送、取消、运行记录。概念与 PI 的 `orchestrator.js` 对得上，是移植落点，但需要拆分 + 补单测。 |
| `core.rs`（Core 聚合/路由装配/鉴权/账号/会话/偏好） | **改造** | 鉴权中间件（回环 + 随机 token + 拒绝 `Origin`，`core.rs:186-196`）设计正确，保留。但 `router()` 把 15 条核心路由与各模块 `merge` 混在一起，`stats/status` 也在其中，边界不清。 |
| `model.rs` + `model_protocols.rs` | **保留骨架，改造** | OpenAI SSE 增量 + 工具参数拼接 + Claude/Gemini 适配（`model_protocols.rs`），有 4 个集成测试。**问题**：Claude/Gemini 走非流式 `request()`（`model_protocols.rs:316,323`）；错误全部 `map_err(|_| "泛化中文")`，丢底层诊断。 |
| `onebot.rs` + `connections.rs` | **保留骨架，改造** | 正向 WS 客户端 + echo/oneshot 匹配（15s 超时）+ `supervise` 15s 重连（`connections.rs:134-188`）。**问题**：只解析 `post_type=message`（`onebot.rs:40-63`），**不处理 notice/meta**（拍一拍/撤回/禁言）；无主动心跳；重连无退避；`workspace::load` 失败静默 `continue`（`connections.rs:86`）。 |
| `qq_tools.rs` | **保留，扩充** | 群作用域工具 + 显式启用门控（`qq_tools.rs:27`），概念正确。工具集远小于 PI（缺表情/提醒/跨会话/节日/引用/转发等）。 |
| `network.rs`（出网 + SSRF 防护） | **改造（收敛点）** | `fetch_public_bytes` 有私网/回环拒绝、DNS 钉、重定向循环上限（`network.rs:71-167`）——**保留**。但全项目有 **4 处** 独立构造 HTTP 客户端，代理语义不一致（见问题清单 P4）。 |
| `prices.rs` | **改造** | 10 家官网抓取 + 解析 + 缓存；**独立裸 `reqwest::Client`，不读代理**（`prices.rs:557-560`），且只是静态解析，缺 PI 的汇率/峰谷/历史版本。 |
| `snow.rs` / `snow_downloads.rs` / `snow_install.rs` | **保留，扩充** | 事务式安装（校验/暂存/staging/备份/回滚）+ 摘要校验质量高（`snow_install.rs`、`snow_downloads.rs`），测试充分。**问题**：进程管理按 `PathBuf` 索引而非账号（多账号共用目录会互相覆盖管理权）；无反向 WS。 |
| `vault.rs`（DPAPI） | **保留** | Windows 下密钥加密存储（`vault.rs`），是相对 PI 明文凭据的**净改进**，必须保留为唯一凭据路径。 |
| `harness.rs`（外部子进程） | **保留骨架** | 无 shell 拼接、参数数组、去 token 环境变量、Job Object 杀进程树、stdout/stderr 上限、超时（`harness.rs:128-236`）——进程隔离质量高，可作为"插件/工具隔离执行"的替代范式。 |
| `extensions.rs` | **改造（能力边界）** | 当前**不执行任何旧 JS 插件**，只支持"纯提示词技能"注入（`extensions.rs:1,126-135`）。这是与 PI"主进程执行任意 JS"的正面决裂方向，保留方向，扩充能力。 |
| `themes.rs` + `audio.rs` + `gpu.rs` | 保留 / 保留 / **废弃或隔离** | 数据型 `.qqtheme` 白名单导入导出（`themes.rs`）与 WinMM 音效（`audio.rs`）保留；`gpu.rs` + `bin/slint-prototype.rs` 是酒狐候选，**用户未定案**，应留在 feature 后不进主构建。 |
| `community.rs` | **改造** | 社区/市场只读代理（4 路由），与 PI 的完整市场（上传/发布/签名/账户）差距大。 |
| 错误类型 | **废弃（三套并存）** | `core.rs:127-141` 的 `Error(String)` + 各模块重复的 `type ResultJson`/`fn error()`（`migration.rs:6`、`snow.rs:23`、`workspace.rs:14` …）共 9 处 + 非 HTTP 模块的 `Result<_,String>`。必须统一为一套。 |

## B. Flutter UI 逐模块结论

| 文件 | 结论 | 理由 |
| --- | --- | --- |
| `core_client.dart`（IPC 客户端 + 进程握手） | **保留骨架** | 32B 随机 token + 子进程 stdout 首行握手 + 130s 超时（`core_client.dart:22-65`）设计正确。**但只有请求/响应，无推送**。 |
| `desktop_bridge.dart` + `flutter/windows/runner/*` | **保留** | 托盘/自启/目录/URL 的 MethodChannel，Windows runner 实现（`flutter_window.cpp`）。 |
| `qqaf_app.dart` / `desktop_pages.dart` / `workspace_page.dart` | **改造** | 页面结构完整（18 个 section），但**全局 3s 轮询**（`qqaf_app.dart:51`、`desktop_pages.dart:805`、`workspace_page.dart:75`）替代推送；`workspace_page.dart` 3163 行、`desktop_pages.dart` 2466 行，可维护性差。 |
| `app_style.dart` / `startup_animation.dart` | **保留** | 主题系统 + 启动动画，是验收基准的一部分。 |
| 旧栈 `app/{electron,server,ui}` + `tools/check-*.mjs`（42 套 CDP 脚本） | **废弃/归档** | 与 Flutter+Rust 无关，是旧 Electron 控制台与回归脚本，混淆主仓库，应移出或显著归档。 |
| `docs/ARCHITECTURE.md` 等旧栈文档 | **改造** | 描述的是旧 Electron/JS 架构，需重定位或加显著标注，避免与新栈混淆。 |

---

## C. QQAF 现状问题清单（现象 + 锚点 + 为什么改 + 替代设计）

> 规则：每条必须是"与目标架构冲突"或"不理想来源"，不是"顺手优化"。

| # | 现象 | 锚点 | 为什么要改 | 替代设计（方向） |
| --- | --- | --- | --- | --- |
| P1 | 配置字段"能存不能用"：`proactive`/`chatActive`/`sticker`/`memory.consolidate*`/`api.thinkingMode/Effort/Budget`/`providersSourceYaml`/`customPersonas`/`store.keepSessionFiles`/`security.allowPrivateImageHosts`/`snowluma.hookAutoLoad`/`server.*` 等 Rust 全库零引用 | `native/resources/default-config.json:114-215`；`NATIVE-FEATURE-MATRIX.md:33,58` | 冻结的是"配置字段含义与默认值"，但当前这些字段**有默认值却无执行语义**，等于对用户撒谎 | 二选一且必须选：要么实现语义，要么从默认配置移除并在迁移中标注"未实现/已废弃"。禁止留"能保存"的空壳 |
| P2 | IPC 无推送，全靠轮询 | 无 SSE/WS；`qqaf_app.dart:51`、`desktop_pages.dart:805`、`workspace_page.dart:75` 均 3s；流式靠落库再轮询（`model_protocols.rs:415`） | 目标要求"内核保留本地控制面，供旧 ui-next 当仪表盘"，且验收要跑 SSE 事件名/payload 比对 | 在 Rust 内核加 `GET /events`（SSE），事件名/payload 对齐 PI（见 02 的 OneBot/会话域）；Flutter 改为订阅 + 增量更新 |
| P3 | 错误类型三套并存、错误信息被泛化吞掉 | `core.rs:127-141`；9 处重复 `fn error()`；`network.rs`/`model*` 大量 `map_err(\|_\| "泛化中文")` | 统一错误码是目标明确允许且鼓励项；当前无法从错误判断失败类型 | 一套统一错误类型 + 错误码枚举；底层错误保留 `source`/detail；HTTP 映射集中一处 |
| P4 | 出网入口 4 处、代理语义不一致 | `core.http`（`core.rs:115-118`，不读代理，用于 `/model/chat`、community 登出）；`network::client/builder`（读代理）；`prices.rs:557-560` 裸 client（不读代理）；`network::fetch_public_bytes`（读代理+SSRF 防护）；`snow_downloads::client`（GitHub 专用重定向） | 目标要求"出网只允许一个模块：配置 > 环境 > 直连" | 收敛为单一出网模块；`core.http`/`prices` 并入；回环与内网强制直连写成测试不变量 |
| P5 | 队满即丢，无背压可见 | `DatabasePool::call` `try_send`（`core.rs:73-78`）队满返回"存储队列繁忙" | 静默降级不留可见状态属反模式 | 要么有界等待 + 背压指标，要么显式告警事件；队列状态可观测 |
| P6 | schema 迁移无框架、失败静默 | `storage.rs:53` `let _ = ALTER TABLE ...` | 磁盘格式允许改，但**必须交付幂等/可回滚/可验证的迁移工具** | 引入 `user_version` 驱动的版本化迁移；失败必须显式报错并可回滚 |
| P7 | OneBot 只处理 message 事件 | `onebot.rs:40-63` 只 `post_type=message` | 冻结项含"OneBot v11 报文与事件字段"；notice/meta 缺失会让拍一拍/撤回/禁言行为丢失 | 补齐 notice（poke/recall/group_ban 等）与 meta（lifecycle/heartbeat） |
| P8 | 会话详情/流式展示是"读库拼装" | `desktop_pages.dart:975-1010`；`model_protocols.rs:415` | 与 PI 的 session-start/update/end 语义不同，验收无法逐字段比对 | 对齐 PI 的会话事件语义（见 02 会话域），用 SSE 驱动 |
| P9 | 旧栈与旧文档混在主仓库 | `app/{electron,server,ui}`；`tools/check-*.mjs`；`docs/ARCHITECTURE.md` | 禁止"新旧两套约定并存" | 归档到单独目录/仓库，README 明确新栈为唯一入口 |
| P10 | 酒狐占位分支散布 | `core.rs:444`、`themes.rs:189` 强置 `winefox_enabled=false`；`app_style.dart:606-618` | 用户已明确排除，占位分支是噪声 | 收拢到单一 feature/开关，主路径不留 winefox 分支 |

## D. 现有夹具与可执行命令（保留为验收基础）

- Rust：`native/tests/{core_integration,model_protocols,workspace_integration}.rs`（全自包含：临时目录 + 内存 axum mock + mock OneBot + `oneshot` 直打 router）。
- 命令：`tools/run-native.ps1 -Mode test|format|build|release [-CleanRelease]`（可传 `-CargoHome/-RustupHome/-CompilerBin`）。
- Flutter：`flutter/test/*.dart`（`core_process_test.dart` 需 `QQAF_CORE_EXECUTABLE` + `QQAF_NATIVE_DATA_DIR` 否则 skip），`flutter analyze --no-pub`、`flutter test --no-pub`。
- 打包/验证：`tools/build-clean-experimental.ps1`、`python tools/package-clean-experimental.py`、`python tools/verify_clean_package.py`。
- 夹具资源：`native/resources/{default-config,fresh-config,personas,fresh-personas,snowluma-compatibility}.json`、`legacy-routes.txt`（旧 79 接口清单）。
- SnowLuma 固定夹具：`snow_downloads.rs` 硬编码 v1.14.22 官方 SHA-256/尺寸 + `snowluma-compatibility.json`。

> 结论：这些夹具是**真实复用资产**，重建后必须继续通过，且要被扩展为"同剧本在 PI 与新版上逐字段比对"的 Harness（见 `04` 验收要求）。
