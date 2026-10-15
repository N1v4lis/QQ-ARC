# QQAF 重建 · 决策交付包（本轮：评估 + 映射 + 冲突 + 三堆 + 迁移设计）

> 本轮**只交付设计结论，不含实现代码**。等待你确认后再进入实现。
> 底座：`https://github.com/N1v4lis/QQARCFOX/tree/RS0.2.0`（Flutter Windows UI + Rust 内核，每账号独立 SQLite WAL）
> 业务来源：`D:\QQ ARC PI`（Electron + Node，只读）；上游：`https://github.com/K0nd1us/QQ-agent`（tag `main`，commit `95f8f62`，version 0.4.0）
> 实测数据根：`D:\QQ ARC\arc-data`

## 本包目录

| 文件 | 内容 |
| --- | --- |
| `01-qqaf-assessment.md` | QQAF 现状评估：逐模块三分（保留/改造/废弃）+ 问题清单 |
| `02-pi-mapping.md` | PI 业务逐域映射到 QQAF：保留/改造/废弃/新增 |
| `03-conflict-rulings.md` | 两边同名不同义的概念裁决清单（含已知必查项） |
| `04-business-triage.md` | 业务三堆分流：上游原始语义 / QQ ARC 增量 / 已核实缺陷 + 待裁决折中 |
| `05-data-migration.md` | arc-data → 新模型的数据迁移设计（幂等/可回滚/可比对） |

## 三条先给出的硬结论

1. **PI 的存储模型是"多库 + 根级身份证明"，与本轮要求的单写入者天然相容。**
   PI 每账号一个 `account-storage.sqlite`，根级只有 `storage-bindings.json`（身份/代际权威）和 `accounts.json`（注册表）；`storageId`(uuid) + `generation`(单调) + 库内 `storage_meta('storage-binding')` 三方互证。**这与 QQAF 现有"每账号独立 WAL"方向一致**，可以合并为同一套约定，而不是两套并存。（证据见 03 与 05）

2. **PI 有一个必须整体裁决的"重机制"：门闩 + 停机搬迁。**
   它保证"宁停不猜"（lease/锁永不过期、恢复需人工确认、源永不删除），代价是**每次存储读**叠三层 `withStorageOperation`（门闩文件建删 + 许可 fsync + 事件日志），并触发 `integrity_check`；实测 `.storage-operations/<uin>/events.jsonl` 已达 **62 MB / 239,244 行且只增不减**。这是当前最大的性能与磁盘债，**不能按原样搬进 Rust 内核**，必须在 03 里对"保留到什么程度"做明确裁决。

3. **两份既有代码都不理想，各有各的欠债，且方向相反。**
   - PI 欠的是"过度工程 + 双轨遗留"：`storage-*` 与 `account-db-*` 两代存储、`legacy-*`/`stripObsoleteFields`/`migrateLegacySkills` 长期共存、插件在主进程执行任意 JS。
   - QQAF 欠的是"名存实亡"：大量配置字段能保存但无执行语义（`proactive`/`chatActive`/`sticker`/`memory.consolidate*`/`api.thinking*` 等 Rust 全库零引用），IPC 无 SSE 只靠 3s 轮询，错误类型三套并存，出网客户端 4 处且代理语义不一致。
   结论：**两边都要改，但改的方向由"哪套是唯一约定"决定，而不是"谁写的更新"。**
