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

本轮按旧架构 79 个接口、32 组配置核对业务和 UI。新界面已覆盖总览、会话、存档、记忆、用量、人设、账号、API与搜索、白名单、聊天设置、桌面端、个性化、主题、OneBot、进阶、工具、插件、技能和市场入口。**页面覆盖不代表旧功能全部迁移完成**；详见 [功能迁移清单](docs/NATIVE-FEATURE-MATRIX.md)。

| 已接通的链路 | 当前边界 |
| --- | --- |
| 多账号 SQLite WAL、独立写队列、消息去重、正文分页与搜索 | 正常消息不做 JSON 文档转换；旧库不能直接打开 |
| OneBot WS 文本收发、白名单/屏蔽、活跃档位与峰谷、自动回复队列 | 自动回复首次默认关闭；媒体、主动话题和多 QQ 自动登录待迁移 |
| 提供商目录、默认/会话模型、首轮故障备选、文本工具循环 | OpenAI 兼容及官方 Claude/Gemini 文本协议；多模态执行和完整工具集待迁移 |
| 人设三栏手动保存、默认继承、内置只读、共享自定义模板与保存记录 | 模板完整 CRUD、跨账号使用统计和自动清理待补齐 |
| 官方价格目录、多选筛选、Logo、来源链接与按站点/模型自定义单价 | 条件价格不自动套用；缓存分项、历史重算和定时更新待迁移 |
| 搜索/网页读取、HTTP/HTTPS 本地代理、纯提示词技能 | 旧 Node/JS 插件不能直接执行；MCP/Harness 和市场安装待迁移 |
| SnowLuma 启停、状态、日志、WebUI、GitHub Release 查询 | 外部 SnowLuma 自带运行时；下载、升级和注入登录不在本轮已接通范围 |
| 默认/明暗/系统主题、Minecraft 背景字体图标和拉杆、托盘与显式自启 | 完整主题包与启动动画待迁移；酒狐排除且禁用 |
| 官方格式消息副本的显式迁入 | 支持正文、媒体和引用关联；不是整个旧库的无损迁移 |

Windows 密钥通过 DPAPI 加密后保存在独立账号库，账号之间隔离；普通配置拒绝密钥字段。QQAF 核心与 Flutter 界面不依赖 Node.js。用户自带的 SnowLuma 是独立 OneBot 组件，启动它会使用其自身随附的运行时，不能把这种场景宣称为整个系统完全没有 Node。

酒狐未参与本轮迁移，开关默认关闭且禁用。所有实验数据与旧安装分离，不自动读取旧库、导入旧配置或注册开机启动。

## 构建与开发

| 目录 | 用途 |
| --- | --- |
| `flutter/` | 当前实验版桌面 UI 与 Windows runner |
| `native/` | Rust 核心与独立存储；可选 Slint 候选验证 |
| `app/` | 旧架构归档源码，用于迁移参考 |
| `tools/` | 构建、检查与开发工具 |
| `docs/` | 迁移状态、设计记录与归档说明 |

后续开发使用本分支，实验构建不覆盖旧安装，也不直接读取旧版数据库。Windows 开发需要 Flutter 3.47.6、Rust 1.92+ 及 Visual Studio C++ 桌面构建组件；最终用户运行不需要开发工具链。

构建步骤见 [Flutter 说明](flutter/README.md) 与 [Rust 核心说明](native/README.md)。分发需包含完整 Flutter Release 目录和 Rust 核心，不能只复制单个 exe。开发包不等于已验收的安装器；干净系统部署、干净系统部署与性能目标仍需验证。

本地检查包括 Rust 单元/模拟集成测试、Flutter 静态分析与控件测试。测试使用本机模拟服务，不发送实际 QQ 或模型请求；通过这些检查不代表全部旧版功能已迁移。

## 计划与文档

- [迁移状态与酒狐候选方案](docs/RUST-SLINT-MIGRATION.md)
- [全部 Milestones](https://github.com/N1v4lis/QQARCFOX/milestones)
- [0.4.5a 归档 Release](https://github.com/N1v4lis/QQARCFOX/releases/tag/v0.4.5a)
- [0.4.5a 改动说明](docs/releases/0.4.5a.md)
- [设计记录](docs/design-notes.md)
- [旧版多账号存储说明](docs/ACCOUNT-STORAGE.md)

模型厂商 Logo 的来源与商标说明见 [资源来源](app/ui/assets/model-logos/SOURCES.json)。
