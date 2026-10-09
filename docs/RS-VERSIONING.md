# RS 版本命名规范

RS = Rust+Slint，沿用实验分支 `Rust+Slint` 的系列代号。当前技术方案仍为 Flutter UI + Rust 核心，酒狐的 Slint / 原生 3D 方案尚在评估；版本代号不改变这一事实。

## 固定名称

| 版本系列 | Codename | 中文版本短语 |
| --- | --- | --- |
| [RS0.1.0](https://github.com/N1v4lis/QQARCFOX/milestone/6) | First Light | 初光 · 故事的起点 |
| [RS0.2.0](https://github.com/N1v4lis/QQARCFOX/milestone/7) | Resonance | 共鸣 · 第一次理解 |
| [RS0.3.0](https://github.com/N1v4lis/QQARCFOX/milestone/8) | Connection | 连接 · 跨越距离 |
| [RS0.4.0](https://github.com/N1v4lis/QQARCFOX/milestone/9) | Echoes | 回响 · 留下的记忆 |
| [RS0.5.0](https://github.com/N1v4lis/QQARCFOX/milestone/10) | Awakening | 觉醒 · 新的可能 |
| [RS0.6.0](https://github.com/N1v4lis/QQARCFOX/milestone/11) | Starlight | 星光 · 黑夜中的指引 |
| [RS0.7.0](https://github.com/N1v4lis/QQARCFOX/milestone/12) | Daybreak | 破晓 · 漫长黑夜的尽头 |
| [RS0.8.0](https://github.com/N1v4lis/QQARCFOX/milestone/13) | Beyond | 彼岸 · 越过已知的边界 |
| [RS0.9.0](https://github.com/N1v4lis/QQARCFOX/milestone/14) | Reverie | 绮梦 · 关于未来的想象 |
| [RS1.0.0](https://github.com/N1v4lis/QQARCFOX/milestone/15) | Tomorrow | 明天 · 新旅程的开始 |

英文 Codename 与中文版本短语由用户于 2026-10-09 指定。以 [rs-version-series.json](rs-version-series.json) 作为唯一结构化来源，保持英文拼写、中文文本与标点，不自行替换为功能摘要。

## Release 与 README

- Milestone 使用完整名称，例如 `RS0.1.0 — First Light — 初光 · 故事的起点`。
- 同一主/次版本的补丁沿用该系列名称，例如 `RS0.1.1 — First Light — 初光 · 故事的起点`。
- 新架构 Release 标题、说明首行和 README 当前版本说明同步使用 RS 版本号、英文 Codename、中文短语。
- Flutter/Cargo 的内部版本仍为合法数字 SemVer（如 `0.1.1`），RS 为公开版本标识，不把 RS 写入这些字段。
- 新架构的命名与旧架构 0.4.x 分开；不重命名已有旧版 Milestone、标签或 Release。
- Milestone 属于仓库；描述记录开发分支，具体功能范围由用户后续指定。

生成当前版本的统一名称：

```sh
node tools/rs-version-meta.mjs
node tools/rs-version-meta.mjs RS0.9.2
```

输出含 `publicVersion`、`codename`、`phrase`、`releaseTitle`、`milestoneNumber`。未来发布时采用这些字段，更新 README 当前版本并沿用此表。命名工具仅生成元数据，不创建 Release、推送标签或改变发布权限。
