# 03 · 冲突裁决清单（两边同名不同义）

规则：每条给出【PI 含义】【QQAF 含义】【冲突实质】【建议裁决 + 理由 + 影响】。**标记 ⛔ 的是必须你拍板的**；其余给出我建议并可先按建议推进。

---

## C1 ⛔ 存储与账号模型：身份/代际机制是否引入

- **PI 含义**：每账号 `accounts/<uin>/account-storage.sqlite`，根级 `storage-bindings.json` 记 `{version:1, generation, accounts[uin]{uin,storageId,status,generation}}`；库内 `storage_meta('storage-binding')` 存 `uin/storageId/version`，读写前 `requireBinding` 三方互证（`storage-binding.mjs:46,66,80,91`）。
- **QQAF 含义**：每账号 `accounts/<account>/native-prototype.sqlite`，账号靠**扫描目录**发现（`core.rs:81-91`），无身份/代际概念。
- **冲突实质**：都"每账号一库"，但 QQAF 无法证明"这份库属于这个账号/这次运行"，无法检测搬错、复制、僵尸覆盖；PI 的 storageId+generation 正是为此。
- **建议裁决**：**引入 storageId + generation，废弃 office 级 lease/owner 四件套的完整度（见 C2）**。
  - `storage-bindings.json`（或等价清单）保留：`version/generation/accounts{storageId,status,generation}`。
  - 库内 `storage_meta` 保留 `uin/storageId`。
  - `status` 只保留 `READY/DISABLED`（PI 的 `CONFLICT_MIGRATING` 属于搬迁期态，见 C2）。
- **理由**：这是"用户既有数据必须可迁移"的最小充分条件，成本低、收益高。
- **影响**：迁移工具需要写入 storageId；`DatabasePool::accounts()` 改为读清单而非扫目录。

## C2 ⛔ 门闩（quiescence）与停机搬迁机制：保留到什么程度

- **PI 含义**：
  - 每次存储操作经过 `withStorageOperation`（`storage-quiescence.mjs:22-55`）：建 `gate.lock`（`openSync(wx)` + `Atomics.wait` 2s 超时同步阻塞）→ 写 lease 许可（`fs.fsyncSync`）→ 写 `events.jsonl` 一行 → 释放再写一行。
  - `storage-runtime` 三层包装（`account-storage-runtime.mjs:7` → `account-db-client.mjs:21` → `account-db-worker.mjs:6`）导致单次读写叠加多轮门闩 + `integrity_check`。
  - lease/锁**永不过期**（`storage-quiescence.mjs:11`），恢复需人工 `confirm` + owner 创建身份证明；源搬迁后**永不删除**（`storage-root-migration.mjs:107`）。
  - 实测 `events.jsonl` = **62 MB / 239,244 行，只增不减**；`.storage-root-owners/*.json` 每次运行 +1 不清理。
- **QQAF 含义**：无门闩、无搬迁、无事件日志；每账号写线程串行 + WAL。
- **冲突实质**：PI 用"重机制"换"绝不静默损坏"，但对单机单进程 QQAF 内核是过度设计，且是当前最大性能/磁盘债。
- **建议裁决（分三档，请你选）**：
  - **A（推荐，最小充分）**：只保留【停机搬迁 + 单实例 owner 证明 + 迁移 journal 的相位/回滚】，**完全移除**每次读写的 gate/lease/events.jsonl。
  - **B（折中）**：保留 A，并保留【低频写路径的轻量 gate】（仅迁移/注册等管理操作，不覆盖正常消息读写）。
  - **C（照搬）**：全量保留（**不建议**：把 62 MB/只增日志和每读 integrity_check 搬进 Rust）。
- **理由**：目标明确"允许批量提交、缓存、状态机化、配额与 GC"，且"迁移期单写入者"已由内核单实例保证；PI 的重机制对单写入者冗余。
- **影响**：若不选 C，则 `05-data-migration.md` 的搬迁流程简化为"停进程 → 快照 → 拷贝 → 校验 → 指针切换 → 回滚"；选 C 则需在 Rust 复刻 gate/lease/owner，工作量与运行开销陡增。

## C3 事件与通道：SSE 事件名/payload 是冻结项，但 QQAF 现在没有 SSE

- **PI 含义**：`GET /api/events`（SSE），事件名 `hello/session-start/session-update/session-end/chat-update/onebot-status/status/feedback/memory-update/vision-scan/snowluma-log/snowluma-status/qq-portable-log`，心跳为注释行 `: ping`（`app.js:1513-1546`）。payload 见 `app.js:609-630`。
- **QQAF 含义**：只有请求/响应 HTTP，Flutter 3s 轮询（`qqaf_app.dart:51` 等）。
- **冲突实质**：冻结条款同时写着"HTTP 路由与 SSE 事件名及 payload 保留"与"旧 ui-next 挂新内核当仪表盘"；而新内核没有 SSE 就无法满足。
- **建议裁决**：**在内核实现 PI 的 SSE 契约（事件名 + payload 逐字段对齐），Flutter 与旧 ui-next 都订阅同一套**。这是"只允许一套约定"的必然结果。
- **影响**：Rust 需引入广播通道（tokio broadcast）并在各业务点发事件；Flutter 轮询改为订阅 + 增量。旧 ui-next（Electron 控制台）可直接接。

## C4 ⛔ 上下文预算：token 预算（PI）还是字符预算（QQAF）

- **PI 含义**：`memory.contextBudgetTokens=32768`、`outputReserveTokens=2048`、`toolsReserveTokens=5000`、`recentMessages=24`；超限抛 `CONTEXT_REQUIRED_OVERFLOW`/`CONTEXT_REQUEST_OVERFLOW`（`config.js:372-375`；`memory-runtime.mjs:83-122`）。
- **QQAF 含义**：字符预算——默认 80 条、历史 24000 字符、记忆 8000 字符（`NATIVE-FEATURE-MATRIX.md:46`；`agent.rs`）。
- **冲突实质**：冻结条款含"提示词锚点复用与超限重置""记忆整理阈值"，这些在 PI 都以 **token** 为量纲；QQAF 以字符为量纲，两者不可"应该一致"。
- **建议裁决**：**以 PI 的 token 预算为唯一量纲**（引入 tokenizer，PI 用 `o200k_base`/tiktoken，`config.js:375`、`vendor/tiktoken`）。字符预算废弃。
- **理由**：冻结语义在 PI 侧；token 才是模型真实限制；QQAF 文档自己也说字符预算"不是精确 Token 预算"（`docs/02-architecture.md:60`）。
- **影响**：需带 tokenizer（可离线 `o200k_base.json`）；所有"超限重置/整理阈值/检索注入"按 token 重算；`05` 迁移需把旧字符配置映射默认 token 配置。

## C5 ⛔ 提示词锚点：冻结项要求保留，但 PI 自己已停用

- **PI 含义**：`resolvePromptAnchor` 完整实现（`prompt.js:630-693`），但运行时 `anchorEnabled = false`（`prompt.js:736`）——**死代码**；`pastPool=past`、`newMemText=''` 一并退化（`:728,:870`）。
- **QQAF 含义**：无锚点。
- **冲突实质**：冻结条款写着"提示词锚点复用与超限重置"，但唯一实现源已自废。若照搬=搬死代码；若不搬=违反冻结条款字面。
- **建议裁决（请你定）**：
  - **A**：按冻结条款**重新实现锚点**（以 `resolvePromptAnchor` 的纯函数逻辑为准：首条仍在窗口 + 追加 ≤ `maxExtraRead=5` + 无新群友，否则 reset），作为活代码。
  - **B**：**明确冻结条款降级**——记录"锚点已被上游废弃"，不再作为验收项。
- **理由**：这是"把缺陷/死代码当规范照抄"的反面警戒点，必须显式裁决，不能默默二选一。

## C6 ⛔ QQ 注入（`oobe-qq-inject`）是否保留

- **PI 含义**：用 SnowLuma 自身 Node ABI `process.dlopen` 加载 `snowluma-win32-x64.node`，`addon.loadModuleManual(pid, dll)` **把 DLL 注入 QQ 主进程**（`oobe-qq-inject.cjs:1-17`；`oobe-snow.mjs:48-56`）。这是"让 SnowLuma 能挂钩 QQ"的便利路径。
- **QQAF 含义**：无注入；且本轮硬规矩写"SnowLuma 保留为外部进程（核心，不改）：Rust 只做客户端 + 托管"。
- **冲突实质**：注入动作是 **QQAF → QQ 进程**，不是修改 SnowLuma 本体，字面上不违反"不改 SnowLuma"；但它是强侵入、依赖授权环境、且是缺陷清单里"用非正常接口"的典型。
- **建议裁决**：**默认不做注入**；保留为**显式用户操作**（与便携 QQ 启动并列），且必须在 UI 明示风险、默认关闭。
- **理由**：符合"最小侵入 + 可见状态"；注入失败要有明确反馈，不能静默降级。
- **影响**：`snow.rs` 的 qq-portable 已补启动/停止；注入作为独立可选动作，需进程身份证明（见 owner，C1）。

## C7 ⛔ 扩展运行时：主进程任意 JS（PI）vs 不执行（QQAF）

- **PI 含义**：`await import(entryUrl)` 在主进程执行扩展 ESM（`plugin-loader.js:318-321`）；zip 允许 `.js/.mjs/.cjs`（`extension-zip.mjs`）；`config.js:414` 自认"等价于任意落地的 JS 会被执行"。
- **QQAF 含义**：明确不执行（`extensions.rs:1`），只有纯提示词技能；`harness.rs` 提供隔离子进程范式。
- **冲突实质**：硬规矩要求"Rust 内核拥有扩展运行时"，又禁止"插件在主进程执行任意 JS"（缺陷清单）。两者要求一个**受控扩展运行时**。
- **建议裁决**：**扩展运行时不进内核主进程**——采用"子进程/沙箱 + 声明式能力"模型：扩展以 `harness.rs` 同款隔离子进程运行，能力经显式声明（如 PI 的 `permissions.web_fetch`），内核只做 RPC 与配额；纯提示词技能继续走 `extensions.rs`。
- **理由**：同时满足"内核拥有扩展运行时"与"禁止主进程任意 JS"。
- **影响**：需定义扩展 RPC 协议与能力白名单；旧 JS 插件不保证兼容（属"废弃"堆）。

## C8 命名冲突：同一词不同义（逐条对齐表）

| 词 | PI 含义 | QQAF 含义 | 裁决 |
| --- | --- | --- | --- |
| 账号 account | `uin`（QQ 号）+ `storageId`(uuid) | `account`（`[A-Za-z0-9_-]` 字符串，含伪账号 `local-settings`） | 统一为 `uin` 主键 + 内部 `accountId`；`local-settings` 伪账号要么保留为保留 id，要么提升为全局配置库（见 `05`） |
| 会话 session / run | PI `sessions/*.json`（一次运行，含 messages/sent/usage/trigger） | QQAF `runs` + `run_events`（运行）+ `messages`（消息） | 采用 PI 语义为主键：`session` = 一次运行；`messages` = 存档。二者是不同实体，不再混叫 |
| 记忆 memory | PI 群友印象 + 文档 + FTS | QQAF `memories` + `memory_documents` | 保留 PI 的 `entry(chat,subject,name,kind,content,revision,state)` 语义 |
| 暂停 pause | PI `POST/GET/DELETE /api/pause`（全局暂停响应） | QQAF `runtime.enabled`（自动回复开关，默认关） | 合并为一个"响应开关"；语义以 PI 为准（可恢复/恢复并全已读），QQAF 默认关的行为保留 |
| 配置 config | PI 全局 `data/config.json` + 每账号 `config.json` | QQAF `local-settings` 伪账号存 `ui` + 每账号 preferences 存 `workspace` | 保留两级；`local-settings` 更名对齐 PI 的"全局配置"概念 |
| 档位 tier | PI `tier1End/tier2End/tier3End` 换算 | QQAF `effective_tier` 近似 | 以 PI 为准（见 02·5） |
| 主题 theme | PI 数据型包 + `.qqtheme` 类 | QQAF `.qqtheme` 白名单 | 一致，统一 `.qqtheme` |
| 更新 update | PI GitHub releases + `kondius.cn` 市场 | QQAF GitHub + SnowLuma 官方 | 更新源统一为 GitHub；市场源待你指定 |
| 工具 tool | PI `tool-registry` + `tools.js` | QQAF `agent::tools` + `qq_tools` | 以 PI 判定顺序 + QQAF 群作用域合并 |

> C4/C5/C6/C7 与 C1/C2 是**必须你裁决**的六项；其余按表推进。
