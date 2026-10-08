# QQ Agent ARCFØX

A modern, beautifully designed QQ Agent.

> [!WARNING]
> ⚠️ **架构迁移公告**
>
> 旧架构的开发已无限期暂停，恢复时间待定。开发者正在尝试将现有架构迁移至 **Rust＋Slint**；若迁移方案的可行性验证通过，将停止旧架构的后续开发。
>
> **0.4.5a** 为架构迁移前归档。迁移尝试及后续改动将在 [Rust+Slint 分支](https://github.com/N1v4lis/QQARCFOX/tree/Rust%2BSlint) 推进；该分支暂不代表功能完整或可替代当前客户端。

QQ Agent ARCFØX 为 QQ Agent 提供重新设计的桌面界面、Minecraft 主题和酒狐互动助手，整合模型连接、联网搜索、用量估算与人设管理。

当前版本：**0.4.5a**。项目仍处于 Beta 阶段，后续功能计划见下方路线图。

## 版本路线图

点击版本号即可直接进入对应 Milestone，查看完整计划与进度。

| 版本 | 计划 |
| --- | --- |
| [0.4.6](https://github.com/N1v4lis/QQARCFOX/milestone/5) | 下一阶段：记忆与上下文底层重构（高性能、低占用、减少 Token）；SnowLuma 更新检测；插件网络代理；主题打包导入/导出与制作规范；替换多 QQ 实例自动拉起/登录及注入方案；功能描述文本重绘。 |
| [0.4.7](https://github.com/N1v4lis/QQARCFOX/milestone/1) | 完成设置 UI 与功能重制：聊天白名单、聊天设置、桌面端、个性化、主题、OneBot（SnowLuma）、进阶、工具与技能。 |
| [0.4.8](https://github.com/N1v4lis/QQARCFOX/milestone/2) | 多账号重做；插件与技能对接本机任意 Agent / Harness；GitHub 源自动检查更新。 |
| [0.4.9](https://github.com/N1v4lis/QQARCFOX/milestone/3) | 用量界面重制；记忆与存档重做；会话功能及 UI 改进。 |
| [0.5.0](https://github.com/N1v4lis/QQARCFOX/milestone/4) | 核心功能验收、UI 功能完备，发布正式 Release。 |

[全部 Milestones](https://github.com/N1v4lis/QQARCFOX/milestones) · [最新发布 0.4.5a：架构迁移前归档](https://github.com/N1v4lis/QQARCFOX/releases/tag/v0.4.5a) · [0.4.5a 改动说明](docs/releases/0.4.5a.md)

## 功能概览

- **桌面界面**：自绘标题栏、侧栏导航、仪表盘及六阶段启动动画。
- **主题系统**：默认与 Minecraft 皮肤，亮色、暗色和跟随系统模式；主题背景、字体、音效与动效配置。
- **API 与搜索**：提供商及模型目录管理、默认模型选择、独立图片/视频输入配置、故障备选顺序与联网搜索配置。
- **价格与用量**：十家官方公开价格来源、厂商筛选及模型 Logo；区分官方连接和中转渠道，自定义价格与仪表盘、用量估算联动。
- **人设管理**：共享模板库、默认人设与单会话覆盖、分栏手动保存和历史记录；群聊独立活跃档位。
- **酒狐助手**：Minecraft 主题下的互动角色，本地理解有限设置指令，通过移动、开卡和拉杆动作调整控件。
- **账号存储**：每账号独立 SQLite WAL 与写入 Worker，消息增量写入、历史分页及原生用量计数；迁移保留原数据备份。
- **OneBot / SnowLuma**：连接配置、运行状态与启动管理。

酒狐的本地指令解析用于已支持的设置操作，不是通用离线聊天模型。未知需求会提示重新表述。官方价格估算受计费条件与汇率影响，实际费用以厂商账单为准。

## 源码与开发

本仓库包含前端、资源、宿主补丁和开发工具；Release 提供源码归档，不是完整安装器。部署工具使用环境相关配置，使用前请核对目标环境。

| 目录 | 内容 |
| --- | --- |
| `app/ui/` | 页面逻辑、桌面外壳、样式与主题资源 |
| `app/server/` | 价格来源、账号存储与服务模块 |
| `tools/` | 开发、部署、版本同步及定点验证工具 |
| `docs/` | 架构、功能说明、开发记录与发布说明 |
| `Wine_Fox/`、`Wine_Fox_PECO/` | 酒狐模型、动画及语音资源 |

部署版本与 `VERSION` 保持一致。验证默认采用四项静态检查，相关交互使用定点测试；具体流程见开发文档。

## 文档

- [0.4.5a 发布说明：架构迁移前归档](docs/releases/0.4.5a.md)
- [多账号原生 SQL 存储](docs/ACCOUNT-STORAGE.md)
- [版本记录](CHANGELOG.md)
- [架构说明](docs/ARCHITECTURE.md)
- [开发指南](docs/DEVELOPMENT.md)
- [验证流程](docs/REGRESSION-WORKFLOW.md)
- [主题系统](docs/THEME-SYSTEM.md)
- [人设功能](docs/PERSONA-PAGE.md)
- [官方价格与模型 Logo](docs/OFFICIAL-MODEL-PRICES.md)
- [酒狐互动与设置助手](docs/WINE-FOX-INTERACTION.md)

模型厂商 Logo 用于品牌识别，来源与商标说明见 [资源来源](app/ui/assets/model-logos/SOURCES.json)。
