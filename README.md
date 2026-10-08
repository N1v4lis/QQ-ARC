# QQ Agent ARCFØX · 实验版

Flutter 桌面界面与 Rust 业务核心的架构迁移实验。

> [!WARNING]
> ⚠️ **实验性版本 · 正在迁移**
>
> 本分支用于验证 **Flutter UI＋Rust 核心**，功能、界面和数据结构仍可能调整，暂不能替代原有客户端。旧架构开发已无限期暂停，恢复时间待定；是否停止旧架构开发，将在新方案完成可行性验收后决定。
>
> **0.4.5a** 为迁移前归档。后续开发在 [Rust+Slint 分支](https://github.com/N1v4lis/QQARCFOX/tree/Rust%2BSlint) 推进。分支名称沿用早期命名，**酒狐采用 Slint 或原生 3D 仍在考量**，尚未定案。

## 当前状态

实验包版本为 **0.1.0**，与归档版 **0.4.5a** 分开记录。Flutter 负责窗口与界面，Rust 负责业务、网络、存储和模型请求；默认运行不依赖 Electron、Node.js、WebView 或 Slint。

| 已接通 | 当前边界 |
| --- | --- |
| 多账号独立 SQLite WAL、消息正文与游标分页 | 实验数据独立保存，旧版数据尚未提供迁入工具 |
| OneBot / SnowLuma 正向 WS 文本收发 | 用户自带 QQ 客户端，连接和发送需手动触发；重连和媒体待迁移 |
| OpenAI 兼容文本模型请求 | 使用 SSE 接收，界面在响应完成后显示；工具与多模态待迁移 |
| 会话记忆与上下文 | 手动记忆、有限历史窗口；精确 Token 预算和自动压缩待实现 |
| 用量及自定义价格估算 | 按返回的用量计价；官方价格源与完整统计待迁移 |
| 明暗色与基础 Minecraft 配色 | 完整主题包、交互动效及酒狐待实现 |

API Key 和 OneBot Token 当前仅在核心会话中保留，退出后需重新输入。尚未迁移的功能包括人设、插件与技能、联网搜索、完整主题、自动登录与更新等。酒狐开关默认关闭且暂时禁用，后续启用需同时满足硬件 GPU 与实际渲染能力检查。

## 构建与开发

| 目录 | 用途 |
| --- | --- |
| `flutter/` | 当前实验版桌面 UI 与 Windows runner |
| `native/` | Rust 核心与独立存储；可选 Slint 候选验证 |
| `app/` | 旧架构归档源码，用于迁移参考 |
| `tools/` | 构建、检查与开发工具 |
| `docs/` | 迁移状态、设计记录与归档说明 |

后续开发使用本分支，实验构建不覆盖旧安装，也不直接读取旧版数据库。Windows 开发需要 Flutter 3.47.6、Rust 1.92+ 及 Visual Studio C++ 桌面构建组件；最终用户运行不需要开发工具链。

构建步骤见 [Flutter 说明](flutter/README.md) 与 [Rust 核心说明](native/README.md)。分发需包含完整 Flutter Release 目录和 Rust 核心，不能只复制单个 exe。开发包不等于已验收的安装器；干净系统部署、运行库打包及性能目标仍需验证。

本地检查包括 Rust 单元/模拟集成测试、Flutter 静态分析与控件测试。测试使用本机模拟服务，不发送实际 QQ 或模型请求；通过这些检查不代表全部旧版功能已迁移。

## 计划与文档

- [迁移状态与酒狐候选方案](docs/RUST-SLINT-MIGRATION.md)
- [全部 Milestones](https://github.com/N1v4lis/QQARCFOX/milestones)
- [0.4.5a 归档 Release](https://github.com/N1v4lis/QQARCFOX/releases/tag/v0.4.5a)
- [0.4.5a 改动说明](docs/releases/0.4.5a.md)
- [设计记录](docs/design-notes.md)
- [旧版多账号存储说明](docs/ACCOUNT-STORAGE.md)

模型厂商 Logo 的来源与商标说明见 [资源来源](app/ui/assets/model-logos/SOURCES.json)。
