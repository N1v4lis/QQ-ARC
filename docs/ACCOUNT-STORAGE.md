# 多账号原生 SQL 存储

日期：2026-10-09。当前归档版本为 0.4.5a，属于 0.4.6 存储目标的底层增量；不代表该 Milestone 已完成。Electron／Node 架构继续运行，原生 UI 架构迁移尚未实施。

## 运行链路

每个 QQ 账号拥有独立 SQLite 文件和写入 Worker。同账号的群聊、私聊按 FIFO 排队，不同账号可同时提交各自数据库。沿用现有账号目录和归属，不受 UI 当前选中账号影响。

正常消息、存档、MemoryStore 和用量缓存直接传递记录对象，不做 JSON 文档封装，也不做 Base64 传输。迁移模块 account-db-legacy.mjs 独立负责官方 JSON 格式导入及早期 v1 库升级；用户主动导出也使用 JSON。配置文件、HTTP 和 OneBot 协议继续使用其原有格式，与存储兼容层无关。

| 数据 | 保存方式 |
| --- | --- |
| 消息正文、发送者、时间、已读等 | message_rows 的 TEXT / 数值列 |
| 图片、媒体、引用回复 | message_media / message_replies 关联表 |
| 会话元数据 | chat_rows |
| 存档与记忆标量 | records / record_fields 原生列 |
| 对话轮次、成员印象 | record_items；文本、角色、时间单独保存 |
| 用量明细 | 每轮 Token、缓存命中、模型、工具名等独立列 |
| 长 systemPrompt / userPrompt 历史快照 | 单个 UTF-8 字符串 gzip 压缩 BLOB，非 JSON 文档 |
| 复杂模型原始响应、未知扩展字段 | V8 二进制 BLOB，按需压缩，保留排障数据 |

普通正文保持 TEXT。旧摘要中可能存在被截断的 emoji，也就是孤立 UTF-16 代理字符；这类异常字符串用二进制保留，避免 UTF-8 转换改变原值。旧接口中的 .json 名称仅为逻辑记录键，不代表仍在运行时写 JSON 文件。

消息追加、撤回、修改、已读和删除按实际消息行提交；不为单条消息重写完整历史。聊天列表只读目录元数据，历史浏览使用 SQL LIMIT/OFFSET。存档索引只读摘要字段，用量读取只读独立计数列，不解压整份提示词和原始响应。

主线程与 Worker 的同步兼容桥使用 V8 二进制和 SharedArrayBuffer，异步写入通过结构化克隆传递对象。单个普通回复缓冲区 1 MiB；较大回复按需扩展，上限 128 MiB。既有运行中的 ChatStore 缓存仍可能装载整个会话，部分查询仍同步等待 Worker，因此这不是完全异步、低内存引擎。

## 写入与迁移

WAL、synchronous=FULL、约 2 MiB 页缓存；每个 Worker 最多把已到达队列的 64 项操作合并为一笔事务。提交后确认写入，待写字节超过 8 MiB 时先 flush；单条大记录可超过阈值。

写入调用返回代表已入队，未必已经提交。正常退出先停接收和任务，再 flush、checkpoint、关闭 Worker。突然杀进程可能丢失未提交队列；FULL 只保证已提交事务的持久性。现有重启工具可能在窗口缩入托盘后强制结束进程，不能把它宣称为保证刷盘的优雅退出。

官方 JSON 导入先完整校验并在事务中写入，成功后归档原文件。导入或归档中断可恢复；损坏文件中止迁移且保留原件。v1 库升级先保存完整 SQLite 快照，包括迁移后新增数据，再事务转换及 VACUUM。辅助缓存也一次性导入并保留备份，归档移动中断会在下次启动继续。

旧 JSON、v1 库和辅助缓存备份均不自动删除。恢复最早的 JSON 快照会丢失之后的新记录；回退应先停止客户端，再导出当前数据库、恢复所属账号数据与原宿主源码。导出拒绝覆盖已有目录及写入源账号目录，使用一致的只读事务。

WAL 运行时可能增长，长只读事务可能延迟 checkpoint；journal_size_limit 不是运行期硬上限。删除记录释放的页可复用，文件不随每次删除立即缩小。

## 模拟性能实测

相同原 ChatStore 接口、3 个账号、24 个群聊/私聊、24,000 条初始消息、360 份八轮存档、240 份记忆；交替追加 600 条消息并标记已读，计时包含 flush。每种方案独立进程执行 3 次，取各项中位数。

| 指标 | 原 JSON | 原生 SQL v2 |
| --- | ---: | ---: |
| 600 次追加＋标已读，含 flush | 5323.4 ms | 78.0 ms |
| 写入阶段 CPU 时间 | 4984 ms | 156 ms |
| 前台单次操作 P95 | 11.797 ms | 0.105 ms |
| 存储测试进程 RSS 峰值 | 84.9 MiB | 180.2 MiB |
| 强制装载全部会话历史 | 56.7 ms | 198.1 ms |
| 空对象缓存读取首屏，各账号 80 条 | 6.24 ms | 3.29 ms |
| 初次构造 / 建库迁移 | 0.06 ms | 1003.0 ms |
| checkpoint 后运行数据 | 10.96 MiB | 5.48 MiB |

突发写入耗时减少约 98.5%，CPU 时间减少约 96.9%；首屏约快 47%。全量历史读取较慢，RSS 峰值约多 95.3 MiB，不能声称已经实现低占用。分页测量时磁盘和系统缓存已被前面的读取预热，只是 JS 对象缓存为空，不代表真正的磁盘冷启动。

结果来自系统 Node v24.19.0 的测试进程及 Worker，包含迁移和读写分配，不是每账号固定常驻占用，也不是整个 Electron、QQ、插件或整机的占用。模拟数据重复较多，压缩率与突发事务合并收益不应外推到任意实际数据。完整原始记录见 [当前测试](benchmarks/account-storage.json)；[v1 测试](benchmarks/account-storage-v1.json)保留作历史参考，测试读法变化后不直接比较 RSS。

## 安装版验证与磁盘

Electron 33.4.11 / Node 20.18.3 / ABI 130 已加载原生驱动并升级两个启用账号。升级前一致快照中的 3,822 条记录全部与当前 SQL 记录一致，两个库 quick_check 均为 ok。副本预演同时核对 7,317 条消息。未启用账号在首次打开时迁移。

原首次导入的 3,821 条记录中，一份消息记录在后续正常运行中改变；升级即时快照逐条一致，不能拿更早的快照覆盖正常新增消息。Dashboard 历史计数未减少、汇总与分项一致；相比最早基线多 6 次正常客户端调用。验证没有主动发送模型或 QQ 请求。

| 本次启用账号相关磁盘项 | 占用 |
| --- | ---: |
| 最早原 JSON 记录 | 330.06 MiB |
| 当前 SQL 数据库 | 192.26 MiB |
| 验证时 WAL＋SHM | 0.365 MiB |
| 最早原数据备份 | 330.16 MiB |
| v1 升级快照 | 152.89 MiB |
| 辅助缓存备份 | 1.78 MiB |
| SQLite 驱动与依赖 | 14.37 MiB |

当前数据库比原 JSON 记录小约 41.8%，但比 v1 的压缩 JSON 文档库大约 39.3 MiB：更多字段独立存储换取按字段查询。所有备份保留时相关总占用约 691.83 MiB，磁盘暂时增加。媒体、日志、插件文件不计入此表；没有通过删除原数据来制造空间节省。

[安装版匿名验证记录](benchmarks/account-storage-live.json)只保存数量、尺寸和核对结果，不包含账号、会话正文、密钥或本机路径。

## 安装、验证与导出

UI 不增加构建流程。后端独立 storage-runtime/package-lock 锁定 better-sqlite3 12.11.1；系统 Node 和 Electron 使用对应绑定。现有 Electron ABI 130 官方预编译绑定按固定 SHA-256 验证，Electron 升级后必须更新 ABI 和验证结果。

首次从官方格式迁入前，可保存私有基线；已迁移账号不要再次覆盖原基线。

~~~powershell
node tools/setup-storage-runtime.mjs --apply
node tools/check-account-storage.mjs
node tools/check-account-storage-runtime.mjs
node tools/benchmark-account-storage.mjs
node tools/patch-host-account-storage.mjs --apply
node tools/restart-agent.mjs --apply
node tools/verify-account-storage-live.mjs
node tools/run-all-checks.mjs --profile static
~~~

~~~powershell
node tools/export-account-storage.mjs --root ACCOUNT_DIRECTORY --out NEW_EXPORT_DIRECTORY
~~~

安装工具先检查全部宿主锚点并保留源码备份，相同原生绑定跳过覆盖，重复部署不重复打补丁。升级绑定应先退出客户端，避免 Windows 文件锁。私有基线和真实数据副本只放在 git 忽略的 scratch 中。

定点检查覆盖两个独立写入队列、FIFO、已读/撤回/媒体/引用/删除/限制、存档/记忆、长字符串和孤立代理字符、大回复、重开、官方导入、v1 升级、辅助归档恢复、损坏导入拒绝、主动导出及用量逐次/汇总/工具计数一致性。测试在完成迁移后禁用 JSON.parse / JSON.stringify，正常存储操作仍能运行。默认回归仅四项静态检查。

上下文选择、摘要、检索、去重和进一步降低缓存占用仍需继续实现；本轮不减少发给模型的 Token。
