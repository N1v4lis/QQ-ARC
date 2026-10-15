# 04 · 业务三堆分流

分流作用在"搬什么"。判定依据：与上游 `K0nd1us/QQ-agent`（`main`，commit `95f8f62`，v0.4.0）做文件级与语义级比对；无法取得上游历史的，用注释日期/ARCFOX 前缀/文件名族推断并标**可信度**。
> 说明：上游仓库可访问（已 clone 到临时目录）。**PI 是上游的超集**：上游 `src/` 全部 51 个文件在 PI 中都有，PI 额外新增 ~120 个 `.mjs/.js` 文件；上游**无**"PI 已删"的文件。因此三分按"文件来源 + 语义变更"划分。

---

## ① 上游 QQ Agent 原始语义（必须保留的对外契约与产品语义）

来源：与上游同名、且语义未变的核心文件。这些承载了冻结项（OneBot v11、响应档位、参与度概率、提示词段序、发送限频、工具判定顺序）。

| 文件族 | 承载的冻结语义 | 可信度 |
| --- | --- | --- |
| `onebot.js` | 正向 WS + HTTP、鉴权、超时（慢/快 action）、重连退避、消息段转换、action 全集 | 高（同名同义，PI 基本未改） |
| `tier-slider.js` | 滑条↔档位换算（10/20/90 分界） | 高 |
| `prompt.js` | 系统/用户提示词段序、人设覆盖、@判定、锚点 | 高（PI 微调，`anchorEnabled=false`） |
| `sender.js` | 限频/切分/去重参数与顺序 | 高（PI 微调） |
| `tool-registry.js` + `tools.js` | 工具可用性判定顺序 + 内置工具集 | 高 |
| `orchestrator.js` | 事件驱动调度、会话唤醒、记忆整理触发 | 高（PI 扩展活跃话题） |
| `sessions.js` | 会话模型与 SSE 语义 | 高 |
| `config.js` | `DEFAULT_CONFIG` 字段全集与默认值 | 高 |
| `memory.js` | 群友印象/成员档案基础语义 | 高 |
| `store.js`（上游） | 每会话 JSON 消息存储 | 高（**PI 已用 SQL 重写，见 ②**） |
| `skills/*`（capabilities/config/errors/manager/manifest/registry） | 技能清单与能力判定 | 高 |
| `webs/search/media`：`web-search.js`、`safe-fetch.js`、`media-links.js`、`md-to-plain.js`、`gif-to-video.js`、`image-*.js`、`video-reader.js`、`vision-scan.js` | 搜索/网页/媒体处理 | 高 |
| 其它：`llm.js`、`providers.js`、`personas.js`、`thinking.js`、`holidays.js`、`reminders.js`、`reply-rescue.js`、`model-prices.js`、`model-vision-docs.js`、`price-feed.js`、`profile.js`、`stickers.js`/`sticker-manager.js`、`market.js`、`community.js`、`routes.js`、`server.js`、`app.js`、`logger.js`、`telemetry.js`、`util.js`、`zip-install.js`、`instance-lock.js` | 业务/路由/日志 | 高 |

> **关键结论**：冻结条款里的"OneBot v11 报文与事件字段 / 响应档位与峰谷换算 / 参与度与随机概率 / 提示词段序 / 发送限频切分去重 / 工具可用性判定顺序 / 记忆整理阈值"**全部来自这一堆**。它们是验收基准，必须在 Rust 中逐字段复刻。

---

## ② QQ ARC 增量（必须保留的产品资产）

来源：PI 独有文件（上游没有）。这是 QQ ARC 相对上游的差异化价值，须保留能力（实现可重写）。

| 增量族 | 文件 | 价值 |
| --- | --- | --- |
| 账号与存储体系 | `account-db-{core,client,worker,legacy}.mjs`、`account-storage-{fs,records,runtime}.mjs`、`account-{context,runtime}.js`、`accounts.js`、`chat-sql-operations.mjs`、`chat-store-sql.mjs`、`storage-*.mjs`（22 个） | 多账号 + 每账号 SQL + 身份/代际 + 停机搬迁 |
| 记忆体系 | `memory-{sql,context,runtime,tokenizer,storage-root}.mjs`、`memory-sharing*.mjs`、`memory-routes.mjs`、`oobe-memory-policy.mjs` | SQL 记忆 + FTS 检索 + 跨会话共享 + token 预算 |
| 人格扩展 | `arcfox-shared-personas.mjs`、`arcfox-plugin-imports.mjs`、`persona-group-card.mjs`、`administrator-policy.mjs`、`chat-authorization.mjs` | ARCFOX 特有 |
| 扩展/主题 | `extension-{manager,routes,storage,zip}.mjs`、`theme-{builtin,packages,routes,service,worker,zip}.mjs` | zip 安装事务 + 主题系统 |
| OOBE/引导 | `oobe-*.mjs`（13 个）、`program-schema-gate.mjs`、`configuration-ownership.mjs` | 首次运行、模型目录、代理、SnowLuma |
| SnowLuma/QQ 托管 | `snow-*.mjs`、`qq-startup-*.mjs`、`qq-process-identity.mjs`、`qq-login-accessibility.ps1`、`onebot-ports.mjs`、`onebot-config-runtime.mjs`、`qq-emotion-segments.mjs` | 集成与托管 |
| 价格/用量 | `official-price-{feed,parsers}.mjs`、`model-vendors.js`、`canonical-usage.mjs`、`arcfox-stats-cache.mjs` | 10 家官网价 + 汇率 + 统计 |
| 更新/维护 | `desktop-updates.mjs`、`github-updates.mjs`、`maintenance-routes.mjs`、`installed-program-root.mjs`、`windows-storage-selection.mjs` | 更新与维护 |
| 网络 | `network-proxy.mjs` | 代理配置 |
| 贴纸增强 | `bound-sticker-manager.mjs`、`sticker-storage.mjs`、`sticker-sharing-routes.mjs`、`sticker-copy-worker.mjs` | 贴纸绑定/共享 |
| 令牌化 | `vendor/tiktoken/*` | `o200k_base`/`cl100k_base` tokenizer |
| 其它 | `product-tasks.mjs`、`scoped-model-compat.mjs`、`profile-routes.js`、`config-numbers.mjs`、`storage-runtime/`（better-sqlite3 依赖树） | 杂项 |

> **注意**：`storage-runtime/node_modules/*` 是 PI 的 SQLite 驱动依赖树（`better-sqlite3`），**不是**业务资产，属③的"外部依赖选择"，不搬进 Rust（Rust 用 `rusqlite`）。

---

## ③ 已核实缺陷（不得继承，必须重做）

下列为**已核实**（附证据）的缺陷，明确不作为规范照抄。

| # | 缺陷 | 核实结论 | 证据 |
| --- | --- | --- | --- |
| D1 | 每次存储读都 fsync + 全库 integrity_check + 门闩文件操作 + 2 行日志 | **属实且因嵌套放大** | `account-storage-runtime.mjs:7` 前后各 `assertCurrent`→`requireBinding`→`integrity_check`（`storage-binding.mjs:89,92`）；`storage-quiescence.mjs:22-55` 门闩 + `fs.fsyncSync` + 事件；三层包装（`account-db-client.mjs:21`、`account-db-worker.mjs:6,26`） |
| D2 | 门闩主线程忙等且无自愈 | **属实（同步阻塞）** | `storage-quiescence.mjs:26` `Atomics.wait(pause,0,0,5)` 在调用线程同步阻塞，deadline 2s；lease/锁**永不过期**（`:11`、`storage-move-lock.mjs:7-8`），恢复需人工 `confirm` |
| D3 | events.jsonl 只增不减 | **属实（实测）** | `storage-quiescence.mjs:33` 仅 `appendFileSync`；实测 `.storage-operations/158732453/events.jsonl` = **62,099,548 B / 239,244 行**，全为 acquire/release |
| D4 | video-cache / sessions / 扩展包 / 更新缓存无上限 | **部分属实** | sessions **默认无上限**（`config.js:329` `keepSessionFiles:0`）；`.storage-root-owners/*.json` 每次运行 +1 不清理（`storage-root-ownership.mjs:10`）；`preservation/legacy-statistics/<sha>/` 无上限（`storage-statistics.mjs:45`）；`usage-days/` 无清理。**日志目录有上限**（`logger.js:19` KEEP_DAYS=7；>256MB 截断留尾 16MB）。**video-cache / 更新缓存未在本次核实中确认**，标记待查 |
| D5 | 控制面默认无鉴权与明文凭据直出 | **属实** | `app.js:1383-1388` `authorize` 在 `server.token` 为空时**恒 true**；明文落盘于 `config.json`（`apiKey`/`dshProviderKeys`/`accessToken`，`config.js:701`）、`accounts.json`（`onebot.token/httpToken`，`accounts.js:131-137`）、`data/account.json`（market）、`community.key`；`oobe-routes.mjs:28` 明文回传初始密码 |
| D6 | 出网各自为政 | **属实（两边都是）** | PI：`web-search.js:59-79` 裸 `fetch`、`safe-fetch.js`、`onebot.js`、`official-price-feed.mjs`、`desktop-updates.mjs`、`github-updates.mjs` 各自出网；QQAF：4 处独立 client（见 01-P4） |
| D7 | 大量空 catch 与失败不可见 | **属实** | `official-price-feed.mjs:10,48,59`；`memory.js:135,581-595`；`sessions.js:90,380,409,431`；`community.js:43,52`；`onebot.js:23,44,254`；`web-search.js:392,475`；`safe-fetch.js:239,473`；QQAF 同病（`storage.rs:53`、`connections.rs:86`、`qqaf_app.dart:146`） |
| D8 | 用户数据落在程序目录 | **属实** | `config.js:16,34` `ROOT=resources/app`，`DATA_DIR=ROOT/data`；配置/密钥/会话/记忆/日志/凭据全在安装目录 |
| D9 | 插件在主进程执行任意 JS | **属实** | `plugin-loader.js:318-321` `await import(entryUrl)`；`extension-zip.mjs` 允许 `.js/.mjs/.cjs`；`config.js:414` 自认 |

### 单列：像设计其实是被迫折中的条目（等你逐条裁决，不在本包替你决定）

| # | 条目 | 现值 + 位置 | "折中"证据 | 待裁决问题 |
| --- | --- | --- | --- | --- |
| T1 | `synchronous=FULL` | `account-db-core.mjs:28` | WAL 常用 `NORMAL`；FULL 每次提交 fsync，持久优先/吞吐牺牲 | Rust 内核是否降为 `NORMAL`（或按账号可配）？ |
| T2 | `keepSessionFiles=0`（不限） | `config.js:329` | 注释：**原为 300**，因 `x||300` 把 0 当未设置而改成 0=不限——**bug 驱动的语义反转** | 恢复为默认上限（如 300/500）还是保留 0=不限？ |
| T3 | `maxMessagesPerChat=0`（不限） | `config.js:301` | 单群消息不封顶 | 同上 |
| T4 | `hotReload=true` | `config.js:416` | 注释自认等价"任意落地 JS 会被执行" | 扩展运行时若改受控模型，hotReload 是否保留？ |
| T5 | 限频/去重参数 | `sessions.js:560` 2s；`:30` 5s；`config.js:377` 6h；`sender.js:145` 500；`account-db-client.mjs:23-25` 128MB | 为防同步 IO 阻塞 event loop / 内存上限 | 全部保留默认值，还是按新内核批量提交能力重算？ |
| T6 | `instance-lock` PID-only | `instance-lock.js:19-27` | 与存储层"绝不信任 PID/无 TTL 回退"（`storage-process-owner.mjs:6`）**理念冲突** | 统一为 owner 证明还是保留 PID 快速判断？ |
| T7 | 遥测默认启用 | `telemetry.js:15` `kondius.cn` | 无开关字段，始终上报 installId+计数 | 默认关闭还是保留开关？ |
| T8 | `memory.js` 缓存上限 8 | `memory.js:119` | 会淘汰活跃会话缓存 | 是否改为按内存预算？ |
| T9 | `formatForPrompt` 硬截断 | `memory.js:498-514` `slice(0,15)/slice(-3)` | 不受配置控制 | 是否改为按 token 预算？ |

> **反模式自检**：以上 D1–D9 不得以"PI 一直这样"为由照抄；T1–T9 不得我替你默认，须逐条裁决（可批量回复"T1=NORMAL, T2=300, …"）。
