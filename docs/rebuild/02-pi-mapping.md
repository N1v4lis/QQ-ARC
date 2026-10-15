# 02 · PI 业务逐域映射到 QQAF

映射结论四态：**保留**（概念与实现都可搬）/ **改造**（概念要留，实现重写）/ **废弃**（不搬）/ **新增**（QQAF 完全没有，PI 有）。
每行给出 PI 锚点（`D:\QQ ARC PI\resources\app\src\`，简称 `src\`）与 QQAF 锚点。

---

## 1. 账号与存储

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 每账号独立库 | **改造（合并方向）** | `storage-binding.mjs:48`；`account-db-core.mjs:11` | 每账号 `native-prototype.sqlite`（`storage.rs:28-30`） | 两者方向一致，合并为一：每账号一库 + 根级身份清单 |
| 根级绑定清单 `storage-bindings.json`（version/generation/accounts/storageId/status） | **新增** | `storage-binding.mjs:46,66,80` | 无（靠扫目录） | QQAF 的 `DatabasePool::accounts()` 只扫目录（`core.rs:81-91`），无身份/代际概念。保留概念、简化实现 |
| 库内 `storage_meta('storage-binding')` 三方互证 | **改造（简化）** | `storage-binding.mjs:91`；`account-db-core.mjs:30` | 无 | 需要"证明这是同一份库"，防止搬错/读错账号 |
| generation/lease/binding/owner 证明四件套 | **改造（大幅简化，见 03）** | `storage-lease.mjs`、`storage-quiescence.mjs`、`storage-process-owner.mjs` | 无 | PI 的完整度极高但代价大；裁决点见 03-C1 |
| 旧 JSON/v1 → SQL 迁移 | **改造** | `account-db-legacy.mjs:3-36`；`storage-migration.mjs:71` | `migration.rs` 只支持官方 JSON 导入 | 见 `05` |
| 根搬迁（跨卷、快照、journal、回滚） | **改造（保留设计，简化）** | `storage-root-migration.mjs:39-107` | 无 | 设计值得保留（快照 + staging + 指针 + 源永不删），但对 Rust 内核版不必全员保留（见 03-C2） |
| 单实例锁 | **改造** | `instance-lock.js:19-27`（PID-only） | 由 Flutter 进程模型保证单核（`core_client.dart`） | PI 的 PID-only 与其存储层"绝不信任 PID"自相矛盾；新内核用单一 owner 证明替代 |

## 2. 配置

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| `DEFAULT_CONFIG` 字段全集与默认值 | **保留（冻结语义）** | `config.js:52-434` | `native/resources/default-config.json` | 字段含义与默认值是冻结项；需逐字段对齐（见问题清单 P1） |
| 废弃字段剔除 `OBSOLETE_PATHS` | **保留（作为迁移规则）** | `config.js:557-589` | 无 | `api.stream`/`budget`/`providersImported`/… |
| 旧字段迁移 `LEGACY_SKILL_MIGRATIONS` | **改造** | `config.js:498-544` | 无 | `tools.knowledgeEnabled→skills.*`、`api.thinking→thinkingMode` 等；迁移一次后不再保留兼容分支 |
| 脱敏派生标记剔除 `stripDerivedFlags` / `hasXxx` | **保留** | `config.js:625-639` | QQAF 反向：`/config` 直接返回，无脱敏 | 防止前端脱敏回传写盘 |
| 数组密钥回填 `preserveSanitizedSecrets` | **保留** | `config.js:647-663` | 无 | |
| 损坏配置改名保留（不静默回落） | **保留** | `config.js:472-484` | 无 | |
| 档位派生（`contextSliderPos` 为唯一真相） | **保留（冻结语义）** | `config.js:688-696` | QQAF 无 | 与 `tier-slider.js` 换算一致 |
| 明文密钥落盘 | **废弃** | `config.js:701`（`apiKey`/`dshProviderKeys`/`accessToken` 明文） | QQAF 用 DPAPI `vault.rs` | 保留 QQAF 的 DPAPI，禁止 PI 的明文路径 |

## 3. 会话与聊天

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| session 对象与索引结构 | **改造** | `sessions.js:266-307` | `runs` + `run_events` 表 | PI 字段更全（trigger/rounds/usage/sent/feedbacks）；需对齐字段与状态机 `waiting/running/done/noreply/error/aborted` |
| 僵尸回收（启动扫 3 天窗口改 aborted） | **保留** | `sessions.js:27,142-183` | 无 | |
| SSE `session-start/update/end` + payload | **保留（冻结语义）** | `app.js:609-630` | 无（轮询 `/runs`） | 事件名与 payload 是冻结项，见 03-C3 |
| 存档（`chat_store` 已读/未读/引用/媒体） | **改造** | `store.js`（上游）；PI `chat-store-sql.mjs`、`chat-sql-operations.mjs` | `messages` + `message_media` + `message_replies` | QQAF 已有关系表方向，补 `read/poke/at_me/recalled/extra` 字段 |
| `GET /api/sessions?limit` 默认 1048576 | **废弃** | `routes.js:1311-1315` | — | 一次拉全量摘要，不搬 |
| 空 catch 遍地的 prune/finish/discard | **废弃** | `sessions.js:90,380,409,431` | — | 不搬，改为显式错误 |

## 4. 记忆

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 群友印象 `group_<群>/<QQ>.json`（印象 ≤300 字，按 content 去重） | **改造** | `memory.js:10-14,92-104,252` | `memories(id,chat,content)` 过简 | 补 subject/name/kind/timestamps |
| 成员档案 + 分类文档 | **改造** | `memory.js`；`memory_documents` | `memory_documents(id,chat,kind,title,content)` | 概念已有，补 kind 全集 |
| 整理阈值与冷却（`consolidateMinImpressions=4`、`consolidateMinIntervalMs=6h`、单成员 `maxKeep=5`、条数变多即放弃） | **保留（冻结语义）** | `orchestrator.js:1473-1508,1750-1788`；`config.js:372-377` | QQAF 无 consolidate | 阈值/冷却/并集-覆盖是冻结项，必须逐字对齐 |
| 向量/FTS 检索（`memory_search` fts5 + bigram + RRF fuse k=60 + `memory_vocab` 低频词） | **改造（可替换实现）** | `memory-sql.mjs:6-44,184-187`；`memory-context.mjs:44-59` | QQAF 无检索 | 语义（并集-覆盖、检索注入上限 8 条）要留，算法可换 |
| token 预算（`contextBudgetTokens=32768`、`recentMessages=24`、`CONTEXT_*_OVERFLOW`） | **保留（冻结语义）** | `memory-context.mjs:26-30`；`memory-runtime.mjs:83-122`；`config.js:372-375` | QQAF 用字符预算（24000 字符） | **冲突点**：PI 是 token 预算，QQAF 是字符预算。见 03-C4 |
| 跨会话共享 + 人设指纹授权 | **保留** | `memory-sharing*.mjs`；`config.js` `memoryAccess` | 无 | |
| `formatForPrompt` 硬编码 `slice(0,15)/slice(-3)` | **废弃** | `memory.js:498-514` | — | 不受配置控制的硬截断，不搬 |

## 5. 参与度与档位

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 滑条↔档位换算（`tier1End=10/tier2End=20/tier3End=90`，3 档 `round((pos-20)/70*100*10)/10`） | **保留（冻结语义）** | `tier-slider.js:18-57` | `agent.rs:103-155` 已实现近似 | 逐字段对齐边界 |
| 峰谷窗口换算（`peakWindowActive`，跨零点） | **保留（冻结语义）** | `config.js:806-813` | `agent.rs:112-137` 已有 | 对齐 |
| 指令禁言强返 `{tier:1,random:0}` | **保留（冻结语义）** | `config.js:765-801` | `agent.rs` 有 commandMute | 对齐 |
| 判定顺序：拍一拍 → 4档全响应 → 被@ → 关键词 → 随机 | **保留（冻结语义）** | `prompt.js:448-514` | `agent.rs:74-102` 近似 | **注意 PI 有"拍一拍 tier1"**，QQAF 缺（无 notice） |
| `@判定` 用 `entry.atMe`（QQ 号级）而非文本匹配 | **保留** | `prompt.js:472-475,342-356` | `agent.rs:84-90` 用 `raw_message.contains` | QQAF 用文本包含，重名会误判。改为字段级 |
| `commandMute.active` 键永不清 | **改造** | `config.js` | QQAF `agent.rs` 有 muted map | 加到期清理 |

## 6. 提示词与锚点

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 系统提示词固定段序（安全规则→工具协议→…→Skill→管理员规则） | **保留（冻结语义）** | `prompt.js:214-286` | `agent.rs` 简易 system 拼接 | 段序与"安全规则不可覆盖"是冻结项 |
| 人设三栏 + `personaByChat` 覆盖（`botName/selfNickname` 永不覆盖） | **保留** | `config.js:721-754` | QQAF 有三栏 | 对齐覆盖规则 |
| `systemPromptOverride` 非空替换人格但安全/工具段仍追加 | **保留** | `prompt.js:232-247` | 无 | |
| 用户提示词组段序（角色→表情→引导→记忆→已读→新已读→未读→新成员→活跃→当前时间） | **保留（冻结语义）** | `prompt.js:710-899` | QQAF 简易 | 稳定→易变排序是设计资产 |
| 提示词锚点 `resolvePromptAnchor` | **废弃（当前）但保留设计** | `prompt.js:630-693`（死代码，`anchorEnabled=false` 于 `:736`） | 无 | **冻结项写着"提示词锚点复用与超限重置"，但 PI 自己已停用**。见 03-C5，需你裁决 |
| `formatEntry` 每次调 skillManager（热路径） | **废弃** | `prompt.js:307-313` | — | 性能问题 |

## 7. 发送限频与去重

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 参数默认值 `minGapMs 1000/maxGapMs 3000/byLengthMs 20/maxPerMinute 80/maxPerHour 500/hardSplitAt 4000/dedupeWindowMs 8000` | **保留（冻结语义）** | `sender.js:17-19,152-158`；`config.js:255-266` | `agent.rs:393-522` 已实现 | 逐值对齐 |
| 切分不切半代理对 | **保留** | `md-to-plain.js:33-59` | QQAF 按字符切 | 对齐（代理对/emoji 不切半） |
| 发送成功后才 `markSent`（非发送前） | **保留** | `sender.js:131-150,203` | QQAF 同（`agent.rs:501-512`） | 一致 |
| 图片 `__img__`/媒体 `__media__` 前缀去重 | **保留** | `sender.js:339-342,395-401` | QQAF 有去重 | 对齐前缀语义 |
| `recentSent` 上限 500 | **改造** | `sender.js:145-149` | QQAF 有 sent map | 硬界化 |
| 每次新建 fetch 无池 | **废弃** | `onebot.js` | — | 走统一出网模块 |

## 8. 工具注册与权限

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 可用性判定顺序（7 步，含 `crossChatSend` 门控、`requires` 能力、`guard` fail-closed） | **保留（冻结语义）** | `tool-registry.js:127-225` | `agent.rs::tools` 简易过滤 | 判定顺序是冻结项，逐条对齐 |
| 执行前二次复核（`chatAuthorized`+`getToolAvailability`） | **保留** | `tools.js:1222-1245` | QQAF 有 enabled 检查 | 对齐 |
| 内置工具全集（messaging/sticker/query/memory/web/media/system 共 ~25） | **改造（补齐）** | `tools.js:159-1180` | QQAF ~11 + qq_tools | QQAF 缺表情/提醒/跨会话/节日/转发/视频 |
| 工具绑定 chatKey，模型无法传 key | **保留** | `tools.js:3-5` | QQAF 用 `chat` 闭包 | 一致 |
| 无副作用审计字段（readonly/destructive） | **改造** | 缺 | 缺 | 补能力边界标注 |
| `memory_append` 只支持 memberImpression | **改造** | `tools.js:266` | QQAF 有 memory_append | 对齐 kind |

## 9. OneBot 客户端

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 正向 WS 客户端 + HTTP API（无反向 WS） | **保留** | `onebot.js:178-180,280-288` | `connections.rs:62-66` 正向 WS | 一致；QQAF 无 HTTP API 通道 |
| 鉴权：WS `?access_token=` + `Authorization: Bearer`；HTTP `Bearer httpToken` | **改造** | `onebot.js:175,179,284` | QQAF 只 `Bearer`（`connections.rs:54-60`） | **令牌放 query 会进日志**，废弃 query 方式，只留 header |
| echo 匹配 | **改造** | PI **不用 echo**（走 HTTP 同步，`onebot.js:305-308`） | QQAF 用 echo + oneshot 15s（`connections.rs:73-85,134`） | QQAF 的 echo 机制更适合 WS；保留 |
| 超时：查询 15s / 发送 90s（`SLOW_ACTION` 正则） | **保留（冻结语义）** | `onebot.js:50-59,277` | QQAF 统一 15s | 需区分慢/快 action |
| 重连指数退避 3s→30s + 代际号 | **保留** | `onebot.js:8-9,126-243` | QQAF 固定 15s（`connections.rs:151`） | 改为退避 |
| `get_login_info` 失败 15s 补拉 | **保留** | `onebot.js:11,245-257` | QQAF 无 | |
| notice（poke/recall/group_ban）与 meta 事件 | **改造（补）** | `app.js:1235-1251` | QQAF 无 | 补齐（见 P7） |
| 消息段 `segmentsToText`（text/at/face/image/record/video/file/reply/json/forward） | **改造** | `onebot.js:423-507` | `onebot.rs:46-60` 只 text+占位 | 补齐段类型（语音转写可能依赖外部能力，标注） |
| QQ 原生表情 action 集（`fetch_custom_face_detail` 等 7 个） | **改造** | `qq-emotion-segments.mjs:64-82` | QQAF 无 | 可按能力可选启用 |

## 10. SnowLuma 托管

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 固定版本 + 摘要校验 + 事务安装 | **保留** | `oobe-snow.mjs:14-74`（v1.14.22, sha256 c8076b…） | `snow_install.rs`/`snow_downloads.rs` 已具备且更严 | QQAF 版本更新，保留 |
| 写 SnowLuma `config/onebot_<uin>.json`（仅本地端口） | **改造** | `snow-onebot-setup.mjs:4-30` | QQAF 只写 `runtime.json` webuiPort | 补 onebot 配置写入 |
| 端口分配（已用端口之上 + `randomBytes(32)`） | **保留** | `onebot-ports.mjs:8-25` | QQAF 用固定 `wsUrl` | 保留分配思路 |
| QQ 进程注入（DLL `addon.loadModuleManual`） | **裁决** | `oobe-qq-inject.cjs:1-17`；`oobe-snow.mjs:48-56` | QQAF 无注入，且明确"不改外部组件" | 见 03-C6：目标硬规矩写"SnowLuma 保留为外部进程（核心，不改）"，注入是 QQAF→QQ 而非改 SnowLuma；需你裁决是否保留 |
| 便携 QQ 启动/关闭/日志 | **保留（已实现）** | `qq-startup-coordinator.mjs:10-125` | `snow.rs` qq-portable 路由（本轮已补） | 对齐启动参数与巡检 |
| 初始密码本地校验（scrypt / webui API） | **改造** | `snow-password-check.mjs:5,21-34` | QQAF 无 | 保留但不得经 HTTP 明文回传（PI `oobe-routes.mjs:28` 是缺陷） |

## 11. 扩展与主题

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 插件在主进程执行任意 JS | **废弃** | `plugin-loader.js:318-321`；`config.js:414` | QQAF 明确不执行（`extensions.rs:1`） | 与目标"扩展运行时归内核"冲突；改为受控运行时（见 03-C7） |
| 扩展 zip 安装事务 + 危险后缀拒绝 | **保留** | `extension-manager.mjs:34-64`；`extension-zip.mjs:5-30` | QQAF 有 import/remove | 合并：保留 zip 安全校验 |
| Skill 清单/能力/manifest | **保留** | `src/skills/*`（上游） | QQAF 有纯提示词技能 | 上限 99 priority、能力判定 |
| 主题（数据类，worker 处理，无脚本） | **保留** | `theme-*.mjs`；`theme-packages.mjs:26-64` | `themes.rs` | 方向一致；QQAF 已是白名单 |
| 主题 zip 严格校验（CRC/重叠/链接/上限） | **保留** | `theme-zip.mjs:3-4` | `themes.rs` 有大小/类型限制 | 对齐上限值 |

## 12. 用量统计

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 价格表 + 用户自定义 + 官方优先 + `locked` | **改造** | `model-prices.js:341-347,544-616` | `prices.rs` | 补"官方匹配后锁定输入框"语义 |
| 峰谷计价（工作日 9-12/14-18，UTC+8，逐笔按发生时刻） | **改造** | `model-prices.js:376-454` | QQAF 无 | 补逐笔峰谷 |
| 汇率折算 + 远程覆盖版本（sha256 revision） | **改造** | `official-price-feed.mjs:7-66`；`model-prices.js` | QQAF 静态解析 | 补远程/汇率 |
| 缓存命中单价（`cached`） | **改造** | `config.js:198`；`model-prices.js` | QQAF 缺 | 补 cached 分项 |
| 按会话/按天/按模型 + 明细下钻 + 工具次数 | **改造** | `canonical-usage.mjs`；`arcfox-stats-cache.mjs` | `usage_breakdown`（models/days/chats） | 补 toolCounts、缓存命中率 |
| 遥测（`kondius.cn`，写死、始终启用） | **废弃/裁决** | `telemetry.js:15` | QQAF 无 | 默认关闭或明确开关 |
| 计费"成功返回即记录、后续错误不删" | **保留** | `sessions.js` | `agent.rs:813-830` 同 | 一致 |

## 13. 维护与搬迁 · 更新 · 启动诊断

| 项 | 结论 | PI 锚点 | QQAF 现状 | 说明 |
| --- | --- | --- | --- | --- |
| 维护路由（sticker-sharing/oobe/memory/sharing/theme/network-proxy/qq-startup） | **改造** | `maintenance-routes.mjs:20-101` | 分散在各模块 | 归并到内核统一控制面 |
| 网络代理 GET/POST/test | **保留** | `maintenance-routes.mjs:82-101` | `network.rs` 读 `cfg.proxy` | 对齐为唯一出网模块配置 |
| 更新检查（GitHub releases 5 页 + TTL 300s + 脱敏） | **保留** | `github-updates.mjs:27-79` | `snow.rs::update` | 合并 |
| 桌面更新（必须 `asset.digest` sha256 + MZ 魔数） | **保留** | `desktop-updates.mjs:11-55` | QQAF 有 installer 但无自更新 | 补 |
| 启动诊断 `boot-diag.log` 逐阶段 | **保留** | `electron/main.js:149-479` | `main.rs` 简易 | 补结构化启动诊断 |
| `onebot.diagnosis` 三种人话 | **保留** | `routes.js:220-226` | QQAF 无 | 补 |
| 日志：分级 + 落盘 + 环形 500 + 防重入 + 256MB 截断 | **保留** | `logger.js:18-181` | QQAF 无统一 logger | 补统一日志模块 |
| SSE 事件全集（`hello/status/feedback/memory-update/vision-scan/snowluma-*/qq-portable-*` 等） | **保留（冻结语义）** | `app.js`、`routes.js` | QQAF 无 SSE | 事件名/payload 冻结，见 03-C3 |
| `POST /api/reset-data` 恒 409 | **保留** | `routes.js:265-302` | QQAF 无 | 保留"需人工审查" |

---

## 汇总计数

- **保留**（设计/契约/安全资产）：约 40 项
- **改造**（概念留、实现重写）：约 45 项
- **废弃**（不搬或必须替换）：约 12 项
- **新增**（QQAF 完全没有）：绑定清单、记忆检索/整理、token 预算、SSE、notice/meta、峰谷计价、统一日志、启动诊断、自更新 等

> 需要你确认的关键裁决点集中在 `03-conflict-rulings.md`（C1–C8）。
