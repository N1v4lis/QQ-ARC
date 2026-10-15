# 05 · 数据迁移设计（arc-data → 新模型）

> 不含实现代码。目标：**幂等、可重跑、可回滚、迁移前在副本上验证、条数/哈希/关键字段比对、迁移期单写入者**。
> 源：`D:\QQ ARC\arc-data`（PI，当前实例）。目标：Rust 内核新数据根。

---

## 1. 源清点（实测）

| 路径 | 内容 | 实测 |
| --- | --- | --- |
| `storage-bindings.json` | 身份/代际清单 | `version=1, generation=1, accounts.158732453{storageId=e41f7751…,status=READY,generation=1}, bootstrap{COMPLETE,MAIN}` |
| `accounts.json` | 账号注册表（**含明文 onebot token**） | 1 账号 `158732453`，`onebot{ws,http,token,httpToken}` 明文 |
| `shared` | 共享白名单 | `{qqs:["487271667"], bypassWhitelist:true}` |
| `accounts/158732453/account-storage.sqlite` | 账号主库 | 1,900,544 B；表 23 张（见 §2 映射）；`journal_mode=wal`、`user_version=0` |
| 同上 · 关键表行数 | | `message_rows=64`、`chat_rows=6`、`message_media=2`、`memory_entries=2`、`memory_index_keys=66`、`memory_search=66`、`memory_vocab=1035`、`records=20`、`record_fields=581`、`record_items=81`、`arc_session_statistics=58`、`storage_meta=10` |
| `accounts/158732453/sessions/` | 旧会话 JSON | **0 文件**（已迁入库或未产生） |
| `accounts/158732453/memory/<chat>/<QQ>.json` | 群友印象 | 存在 `memory/private_487271667/`（成员文件） |
| `accounts/158732453/{config.json,stickers.json,arcfox-memory-phases.json,sticker-images/}` | 账号配置/贴纸 | config 41,588 B；stickers 49,674 B |
| `data/config.json` | 全局配置 | 416 B |
| `data/{official-vendor-prices.json,cloud-global-blocklist.json,arcfox-oobe.json,telemetry.json,boot-diag.log,logs/}` | 全局状态 | 存在 |
| `data/electron-user-data/` | Chromium 用户数据 | 存在（**不迁**，见 §7） |
| `.storage-operations/`、`.storage-root-owners/`、`registration-journals/`、`registration-stage/` | PI 存储机制现场 | `.storage-operations/158732453/events.jsonl` = 62 MB；`.storage-root-owners/` 2 份（**不迁**，见 §7） |
| `storage-runtime/node_modules/`（在 PI 安装目录，不在 arc-data） | better-sqlite3 驱动树 | **不迁**（Rust 用 rusqlite） |

**源指纹（用于幂等）**：对 `storage-bindings.json` + `accounts.json` + 每账号 `account-storage.sqlite` 的**内容 sha256** 生成 `sourceFingerprint`。迁移开始时记录；重跑时若与 journal 记录不一致 → 拒绝，要求新 migrationId。

---

## 2. 表级映射（PI → 新内核）

| PI 表/文件 | 新内核目标 | 映射规则 |
| --- | --- | --- |
| `storage_meta(key,value)` | `storage_meta` | 原样；补写 `uin`/`storageId`/`schema` |
| `chat_rows(path,chat_key,next_id,extra,mtime)` | `chats(chat_key,next_id,extra,mtime)` | 原样 |
| `message_rows(chat,id,mask,mid,ts,sender_id,sender_name,text,self,read,poke,at_me,recalled,extra)` | `messages(...)` **字段全保留** | QQAF 现有 `messages(id,chat,sender,text,timestamp)` 需**扩列**到 PI 全集；`sender`→`sender_id`+`sender_name` |
| `message_media(chat,id,position,kind,url,file,summary,face_id,extra)` | `message_media(...)` 扩列 `face_id`/`extra` | 原样 |
| `message_replies(chat,id,sender,text,extra)` | `message_replies(...)` 扩列 `extra` | 原样 |
| `records(path,shape,mtime)` / `record_fields(path,name,kind,text_value,number_value,data)` / `record_items(path,name,position,kind,role,content,created_at,data,prompt_tokens,completion_tokens,cached_tokens,raw_created,raw_model,tool_name)` | 新 `records/record_fields/record_items` | 通用记录系统；**原样搬迁**（存档/记忆/用量快照都走这里） |
| `memory_entries(id,chat,subject,name,kind,content,revision,state,source_path,source_id,created_at,updated_at)` | `memory_entries` | 原样；`state` 取值 `active/recalled/forgotten/superseded/completed` 保留 |
| `memory_versions(id,revision,content,state,updated_at)` | `memory_versions` | 原样 |
| `memory_search`(fts5) / `memory_vocab` / `memory_index_keys` / `memory_search_*` | 同名 FTS 表 | **新库重建 FTS**（从 `memory_entries` 重填），不搬 `memory_search_data` 内部页；重填后行数应等于 `memory_index_keys` |
| `memory_legacy_imports` / `memory_legacy_pending` | 同名 | 原样（迁移账本） |
| `memory_sharing_rules(id,revision,source,config,updated_at)` / `memory_entry_tags(entry_id,tag)` | 同名 | 原样 |
| `arc_session_statistics(session_id,uin,chat_key,metrics,tools,status,started_at)` | `session_statistics` 或并入 `sessions` | 原样；`metrics`/`tools` 为 JSON 文本保留 |
| `accounts/158732453/config.json` | 该账号配置 | 字段逐一对齐 `DEFAULT_CONFIG`；跑 `OBSOLETE_PATHS` 剔除 + 旧字段迁移（见 02·2） |
| `accounts/158732453/stickers.json` + `sticker-images/` | 贴纸库 | 原样（图片文件搬路径需登记重映射） |
| `accounts/158732453/arcfox-memory-phases.json` | 记忆相位 | 原样 |
| `accounts/158732453/memory/<chat>/<QQ>.json`（印象） | `memory_entries`（`subject`=QQ，`kind`=member） | 逐条转成 memory entry（**幂等**：按 `(chat,subject,content)` 判重） |
| `data/config.json` | 全局配置 | 原样 |
| `data/official-vendor-prices.json` | 价格缓存 | 原样（对应 QQAF `local-settings/official-prices`） |
| `data/cloud-global-blocklist.json` | 全局屏蔽 | 原样 |
| `data/arcfox-oobe.json` | OOBE 状态 | 原样 |
| `accounts.json` 的 `onebot.token/httpToken` | **vault（DPAPI）**，不进配置 | **必须加密**；`config.json` 里明文密钥一律移除（对齐 QQAF `vault.rs`） |

### 命名收敛（对齐 03-C8）
- 账号主键统一为 `uin`（字符串）；QQAF 伪账号 `local-settings` 提升为**独立全局库**，不再混在账号列表。

---

## 3. 迁移流程（相位机 + journal）

仿 PI 的相位机，但按 03-C2 选择简化为"停机搬迁"。所有相位写入 `migrations/<migrationId>/journal.json`：

```
DISCOVERED → SNAPSHOT_INTENT → SNAPSHOT_READY → STAGED → VALIDATED → CUTOVER_INTENT → COMMITTED
                                                        ↘ BLOCKED（人工介入）
```

1. **DISCOVERED**：清点源（§1），计算 `sourceFingerprint`；读 `storage-bindings.json` 建立 `uin→storageId` 映射。
2. **SNAPSHOT_INTENT/READY**：
   - **迁移前在副本上验证**：用 `sqlite3 .backup`（或 `VACUUM INTO`）生成每个账号库的**快照** `*.partial` → 改名 `snapshot`（防半成品，对齐 `storage-migration.mjs:87-91`）。
   - 复制全部侧文件（`config.json`/`stickers.json`/`memory/**`/`sticker-images/**`）到 stage，并逐文件 sha256。
3. **STAGED**：把 PI schema **字段级**转成新 schema（§2）；重建 FTS；转 `memory/**/*.json` → `memory_entries`。
4. **VALIDATED**：见 §5 比对；不通过 → `BLOCKED`。
5. **CUTOVER_INTENT/COMMITTED**：写新根指针（`arc-storage-location.json`，`{version,root,migrationId}`）；写库内 `storage_meta('storage-binding')` 与 `migrated` 标记；源**不删除**（保留供回滚）。

**单写入者**：迁移全程必须 PI 与 QQAF 均停机；启动迁移前检查两边的 owner 证明（PI `proveRootStopped`；QQAF 单实例锁），任一存活即 `BLOCKED`，不得两版同时写同一数据根。

---

## 4. 幂等与可重跑

- 每账号库写 `storage_meta('migration', {migrationId, sourceFingerprint, at, files})`。重跑时若该键存在且 `sourceFingerprint` 匹配 → 直接 `requireBinding` 返回，**不重复写**（对齐 `account-db-legacy.mjs` 的 `migrated` 键思路）。
- `*.partial` 存在即拒绝续跑，要求新 `migrationId`（对齐 `storage-migration.mjs:88`）。
- `memory/**/*.json` → entries 用 `(chat,subject,content)` 判重，保证重复导入不产生重复条目。
- 侧文件用 `COPYFILE_EXCL`（`errorOnExist`），已存在即失败而非覆盖。

---

## 5. 验证（前后比对报告）

生成 `migrations/<id>/verify-report.json`，逐项：

| 维度 | 方法 |
| --- | --- |
| 条数 | 逐表 `COUNT(*)` 源 vs 目标；必须相等（FTS 派生表除外，改为 `memory_index_keys` 数 = `memory_search` 数） |
| 哈希 | 侧文件逐文件 sha256（源 vs stage）相等；快照库与工作库 `PRAGMA integrity_check='ok'` |
| 关键字段 | PC 抽样全量比对：`message_rows` 的 `(chat,id,mid,ts,sender_id,text,self,read)`；`memory_entries` 的 `(id,chat,kind,content,revision,state)`；`record_items` 的 `(path,name,position,content,prompt_tokens,completion_tokens)` |
| 序列 | 每表按主键排序后逐行 diff，输出首个不一致行 |
| 加密 | 迁移后 `config.json`/新清单中**不得出现明文密钥**；token 可经 vault `reveal` 还原为原值（往返测试） |
| 账号身份 | 新库 `storage_meta.storageId` == 源 `storage-bindings.json` 的 `storageId` |

**未通过即 BLOCKED**，不自动 cutover。

---

## 6. 回滚

- 任何 `< CUTOVER_INTENT` 阶段失败：删除 stage（或改名为 `*.retained-<uuid>` 隔离），源与指针未动 → 视为无副作用（对齐 `storage-root-migration.mjs:61-66`）。
- `CUTOVER_INTENT` 后失败：删除新根指针，源保留，重启回旧根。
- 源**永不删除**；提供显式"确认成功后清理源"的独立操作（默认不执行）。
- 回滚演练是验收项（见下）。

---

## 7. 明确不迁移（并说明理由）

| 项 | 理由 |
| --- | --- |
| `data/electron-user-data/`（Chromium 缓存/LocalStorage/Network） | 属 Electron 外壳运行时，新内核无 Chromium；仅需迁移其中**经用户确认的** LocalStorage 偏好（如主题/区间记忆），单独白名单导出 |
| `.storage-operations/`（events.jsonl 等） | 属 PI 门闩机制的运行现场，非业务数据；按 03-C2 简化后不保留 |
| `.storage-root-owners/`、`registration-journals/`、`registration-stage/` | 属 PI 存储机制的运行现场 |
| `storage-runtime/node_modules/`（better-sqlite3 等） | PI 的 SQLite 驱动依赖，Rust 用 rusqlite |
| `data/logs/`、`data/boot-diag.log`、`telemetry.json` | 运行日志/遥测，不迁（可选：保留 log 备查） |

---

## 8. 迁移工具的交付边界（本轮不实现，仅约定）

- 形态：Rust 内核子命令（`qqaf-native migrate --source <arc-data> [--dry-run] [--confirm <migrationId>]`），或独立 `tools/` 二进制。
- `--dry-run`：只执行 DISCOVERED→VALIDATED 并输出比对报告，不 cutover。
- 必须有：`sourceFingerprint` 一致性校验、`COPYFILE_EXCL`、`integrity_check`、回滚路径、可比对报告。
- 验收：**前后条数/哈希/关键字段比对报告 + 回滚演练结果**（对应总验收第 3 条）。

---

## 9. 待你确认的迁移相关决策

1. **03-C2 档位（A/B/C）**决定 §3 是否保留门闩/事件日志。
2. **03-C4（token 预算）**决定 §2 的 `memory` 与 `contextBudget*` 是 token 还是字符。
3. **C8 的 `local-settings`**是保留为伪账号还是提升为独立全局库。
4. `electron-user-data/LocalStorage` 中哪些偏好需要白名单迁移（区间记忆/主题）。
5. 源清理策略：默认不删，是否提供"确认后清理"操作。
