# QQ Agent ARCFØX · RS0.2.0 — Resonance

![Resonance](docs/assets/rs-resonance.svg)

**RS0.2.0 — Resonance — 共鸣 · 第一次理解**

基于 QQ 的智能对话代理框架，正在从旧架构（Electron + Node.js）向新架构（Flutter + Rust）迁移。

> [!WARNING]
> ⚠️ **实验性版本 · 正在开发中**
>
> 本分支是架构重构的实验性版本，采用 **Flutter 桌面 UI + Rust 业务核心** 的全新架构。功能、界面和数据结构仍在调整中，暂不能替代旧版客户端。
>
> **v0.4.5a** 是迁移前的归档基线。当前开发在 [RS0.2.0 分支](https://github.com/N1v4lis/QQARCFOX/tree/RS0.2.0) 推进。RS 代号沿用 Rust+Slint 系列，但 **酒狐互动宠物**（采用 Slint 或原生 3D）在本轮迁移中明确排除，未来方案仍在考量。

---

## 📌 项目简介

**QQAF (QQ Agent Framework)** 是一个功能丰富的 QQ 智能助手框架，支持：
- 🤖 多 AI 模型提供商（OpenAI、Claude、Gemini 等）
- 💬 自动回复与会话管理
- 🎭 灵活的人设系统
- 📊 用量统计与官方价格目录
- 🔌 OneBot 协议与 QQ 工具集成
- 🎨 可定制主题（默认主题 + Minecraft 主题）
- 🧠 记忆系统与存档功能

## 🏗️ 架构概览

### 新架构（当前 RS0.2.0）

```
┌─────────────────────┐
│  Flutter Windows UI │  ← 窗口、导航、表单、页面状态
└──────────┬──────────┘
           │ Loopback HTTP + 随机令牌
           ↓
┌─────────────────────────────────────────┐
│         Rust 核心 (tokio + axum)        │
├─────────────────────────────────────────┤
│  • 工作区 / 账号状态管理                 │
│  • 每账号独立 SQLite WAL 数据库         │
│  • 模型协议与工具循环                   │
│  • OneBot 连接与 QQ 工具                │
│  • 价格目录 / 主题 / Harness / SnowLuma │
└─────────────────────────────────────────┘
```

**关键特性**：
- ✅ 普通运行**不需要** Electron、Node.js、WebView 或 Slint
- ✅ 密钥通过 Windows DPAPI 加密保护
- ✅ 每账号独立数据库和线程，账号间完全隔离
- ✅ IPC 仅监听回环地址，使用随机令牌认证
- ⚠️ SnowLuma 作为外部组件，不随 QQAF 捆绑

### 旧架构（已归档于 v0.4.5a）

```
Electron 无边框外壳
  → Node.js 业务后端
  → WebView UI + Three.js 3D
  → SQLite WAL 存储
```

旧架构开发已无限期暂停，保留作为迁移参考基线。

---

## 🎯 当前状态

### 里程碑目标

**RS0.2.0 的真实目标**：将 v0.4.5a 上正常使用的功能逐项迁移，而非仅追求页面齐全。

### 迁移进度概览

| 状态 | 说明 | 代表功能域 |
|------|------|-----------|
| ✅ **已接通** | 有执行链路、测试证据、异常处理 | 基础外壳、账号管理、干净构建 |
| 🟡 **部分完成** | 主路径存在，但缺失重要行为或验收 | 会话、存档、记忆、人设、模型协议、OneBot、主题 |
| ⏳ **待迁移** | 核心执行链路尚未完成 | 图片/视频、QQAF 更新、插件系统、数据迁移 |
| ❌ **明确排除** | 本轮不实现 | 酒狐互动宠物 |

详细迁移矩阵见 [功能迁移清单](docs/03-feature-matrix.md) 和 [RS0.2.0 验收进度](docs/RS0.2.0-ACCEPTANCE.md)。

### 已接通的核心链路

| 功能域 | 当前能力 | 边界与限制 |
|--------|----------|-----------|
| **存储** | 多账号 SQLite WAL、独立写队列、消息去重、正文分页与搜索 | 正常消息不做 JSON 文档转换；旧库不能直接打开，需显式迁移 |
| **OneBot** | WebSocket 文本收发、白名单/屏蔽、活跃档位与峰谷、自动回复队列 | 自动回复首次默认关闭；媒体、主动话题、多 QQ 自动登录待迁移 |
| **模型** | 提供商目录、默认/会话模型、首轮故障备选、文本工具循环 | OpenAI 兼容及官方 Claude/Gemini 文本协议；多模态和完整工具集待迁移 |
| **人设** | 三栏手动保存、默认继承、内置只读、共享自定义模板与保存记录 | 模板完整 CRUD、跨账号使用统计、自动清理待补齐 |
| **价格** | 官方价格目录、多选筛选、Logo、来源链接、按站点/模型自定义单价 | 条件价格不自动套用；缓存分项、历史重算、定时更新待迁移 |
| **扩展** | 搜索/网页读取、HTTP/HTTPS 本地代理、纯提示词技能 | 旧 Node/JS 插件不能直接执行；MCP/Harness 和市场安装待迁移 |
| **SnowLuma** | 启停、状态、日志、WebUI、GitHub Release 查询、固定版本安装 | 外部组件自带运行时；下载、校验、安装 v1.14.22；升级提示、注入登录待完善 |
| **主题** | 默认/明暗/系统主题、Minecraft 背景字体图标、托盘与显式自启、.qqtheme 导入导出 | 启动动画已接入；完整主题包体验待迁移；酒狐禁用且不可用 |
| **迁移** | 官方格式消息副本的显式迁入 | 支持正文、媒体和引用关联；不是整个旧库的无损迁移 |

> **重要说明**：
> - Windows 密钥通过 DPAPI 加密后保存在独立账号库，账号之间完全隔离；普通配置拒绝密钥字段
> - QQAF 核心与 Flutter 界面不依赖 Node.js
> - SnowLuma 是独立 OneBot 组件，启动它会使用其自身随附的运行时，但这不代表 QQAF 业务核心依赖 Node

---

## 📦 安装与构建

### 最终用户

**当前安装包特点**：
- ✅ 包含 QQAF 界面与 Rust 核心
- ❌ **不捆绑 SnowLuma**（通过界面按钮安装）
- ✅ 干净空白：无账号、无提供商、无密钥、无聊天数据
- ✅ 独立数据目录，不读取旧版数据

**SnowLuma 安装**：
- OneBot 页面提供「安装 SnowLuma」按钮
- 从官方 GitHub 下载指定的 **v1.14.22 Windows 完整包**
- 校验后安装到用户选择的位置（默认程序根目录的 `Snowluma` 子目录）
- 详见 [SnowLuma 安装与版本提示](docs/SNOWLUMA-INSTALLATION-RS.md)

### 开发者

#### 环境要求

- **Flutter**: 3.47.6+
- **Rust**: 1.92+
- **Visual Studio**: C++ 桌面构建组件（仅 Windows 开发需要）
- **Node.js**: 用于开发工具（素材同步、历史检查），非 QQAF 运行依赖

#### 目录结构

| 目录 | 用途 |
|------|------|
| `flutter/` | Flutter 桌面 UI 与 Windows runner |
| `native/` | Rust 核心、存储、模型协议、OneBot 等 |
| `app/` | 旧架构归档源码（迁移参考，不是运行时） |
| `tools/` | 构建、打包、验证与开发工具 |
| `docs/` | 迁移状态、设计记录与验收文档 |

#### 快速开始

```powershell
# 1. 切换到源码目录
Set-Location -LiteralPath 'E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next'

# 2. 检查当前分支和状态
git status --short --branch
git log -1 --decorate

# 3. 同步 Flutter 资源
./tools/sync-flutter-assets.ps1

# 4. 运行 Rust 测试
cargo test --locked --manifest-path native/Cargo.toml

# 5. 运行 Flutter 测试
Push-Location flutter
flutter analyze --no-pub
flutter test --no-pub
Pop-Location

# 6. 构建 Rust 核心
./tools/run-native.ps1 -Mode build

# 7. 运行 Flutter 应用（开发模式）
Push-Location flutter
flutter run -d windows
Pop-Location
```

#### 生成干净安装包

```powershell
# 完整构建（从源码）
./tools/build-clean-experimental.ps1 `
  -FlutterBinary <flutter.bat 路径> `
  -CargoHome <cargo-home 路径> `
  -RustupHome <rustup-home 路径> `
  -CompilerBin <编译器路径> `
  -OutputRoot <输出目录> `
  -CreateInstaller

# 仅打包已验证的 Bundle
./tools/build-clean-experimental.ps1 `
  -BundlePath <已验证的 bundle 路径> `
  -OutputRoot <输出目录> `
  -CreateInstaller
```

详细构建说明见 [构建、打包与产物](docs/05-build-release.md)。

---

## 🧪 测试与验证

### 测试套件

**Rust 测试**：
- ✅ 单元测试：13 项通过
- ✅ 核心集成测试：5 项通过
- ✅ 模型协议测试：4 项通过
- ✅ 工作区测试：19 项通过（2 项 ignored fixture）

**Flutter 测试**：
- ✅ 静态分析（flutter analyze）：通过
- ✅ 控件/页面测试：通过（包含 SnowLuma 安装测试）

**构建验证**：
- ✅ Windows Release 构建：通过
- ✅ 干净安装包验证：通过

> **注意**：以上为上次记录（2026-10-09），本次文档交付未重新执行业务测试或真实 QQ/模型请求。

### 验证命令

```powershell
# Rust 单元测试
cargo test --locked --manifest-path native/Cargo.toml

# Flutter 分析与测试
./tools/sync-flutter-assets.ps1
Push-Location flutter
flutter analyze --no-pub
flutter test --no-pub
Pop-Location

# 干净包验证（需要已构建的 bundle）
python ./tools/verify_clean_package.py <bundle 路径>
python ./tools/test_clean_packaging.py
```

### 验收纪律

1. ✅ 测试报告必须说明分支、提交和工作区状态
2. ⚠️ 未执行真实第三方服务时，不能把 mock 结果写成真实兼容
3. ⚠️ UI 可见不代表保存、执行、异常和重启恢复正确
4. ⚠️ 失败测试先判断原因，不能直接删除断言
5. ✅ 断言优先验证性质，不要把可扩展资源数量写死
6. ⚠️ 构建成功不等于里程碑完成，必须回看功能矩阵

---

## 🔐 数据与安全

### 数据隔离

- ✅ 使用新架构数据根目录，不自动读取旧数据
- ✅ 每账号独立 SQLite 数据库和 OS 线程
- ✅ 正常消息使用 SQL 原生字段，JSON 仅用于协议和配置
- ✅ 不同账号可以并行处理，同一账号内操作串行

### 密钥保护

- ✅ Windows 下使用 DPAPI 保护 API 密钥
- ✅ 密钥不能出现在配置、日志、主题包、构建清单中
- ⚠️ 非 Windows 平台的密钥保险库尚未设计

### 网络安全

- ✅ Rust 核心只绑定回环地址（127.0.0.1）
- ✅ Flutter ↔ Rust 使用 32 字节随机令牌认证
- ✅ 所有外网请求有边界、超时和取消路径
- ✅ 自动测试使用本地模拟服务，不发送真实 QQ 或模型请求

### 主题导入安全

- ✅ `.qqtheme` 只接受白名单字段
- ✅ 限制背景大小、尺寸和资源类型
- ✅ 拒绝导入密钥、自启、账号、聊天、人设等敏感字段
- 📖 制作规范见 [主题制作指南](docs/THEME-AUTHORING-RS.md)

---

## 🚀 下一步计划

### 第一阶段：建立可执行验收表

1. 从功能矩阵拆解为 Rust、Flutter、持久化、异常、测试五列
2. 对照 v0.4.5a 写出每项旧行为的输入/输出/副作用
3. 识别当前仅为占位或仅保存配置的接口

### 第二阶段：优先补核心风险（推荐顺序）

1. **模型协议完善**：流式、thinking、取消和用量事件统一化
2. **多媒体支持**：图片/GIF/视频输入和模型协议
3. **记忆系统**：整合、上下文压缩、成员档案、存档恢复
4. **用量与价格**：Dashboard、Usage、价格目录、历史价格联动
5. **OneBot 完善**：主动话题、持续话题、表情包、群管理、多 QQ 生命周期
6. **扩展系统**：插件兼容层、技能市场、Harness/MCP、更新回滚
7. **SnowLuma 完善**：多实例、注入、自动登录、兼容矩阵
8. **UI 验收**：完整人工验收和主题细节收口

### 第三阶段：功能交付标准

每个功能必须交付：
- ✅ Rust 核心实现和数据迁移说明
- ✅ Flutter 完整状态（加载/空态/成功/失败/取消）
- ✅ 单元/集成测试
- ✅ 模拟验证与真实验证的分别记录
- ✅ 更新功能矩阵、验收记录和 CHANGELOG
- ✅ 重新生成干净包前检查无开发数据混入

---

## 📚 文档索引

### 核心文档

- 📋 [项目状态与历史](docs/01-project-state.md)
- 🏗️ [架构交接说明](docs/02-architecture.md)
- 📊 [功能迁移矩阵](docs/03-feature-matrix.md)
- 📦 [构建、打包与产物](docs/05-build-release.md)
- 🔐 [数据、安全与第三方边界](docs/06-data-security.md)
- 🧪 [验证记录与验收纪律](docs/08-verification.md)
- 🎨 [UI 基线与验收清单](docs/12-ui-acceptance.md)

### 开发指引

- 🗂️ [源码与开发入口](docs/10-source-index.md)
- 📝 [下一位 Agent 的实施计划](docs/07-next-agent-plan.md)
- 📖 [历史工作、版本与决策](docs/11-history-decisions.md)
- 🔧 [文档维护规则](docs/09-document-maintenance.md)

### 专题文档

- 🐾 [SnowLuma 安装与版本提示](docs/SNOWLUMA-INSTALLATION-RS.md)
- 🎨 [主题制作指南](docs/THEME-AUTHORING-RS.md)
- 📦 [v0.4.5a 归档基线](docs/04-legacy-baseline.md)
- 🔄 [RS0.2.0 验收进度](docs/RS0.2.0-ACCEPTANCE.md)
- 🗺️ [功能迁移清单](docs/NATIVE-FEATURE-MATRIX.md)

### 旧架构参考

- 📜 [旧版多账号存储说明](docs/ACCOUNT-STORAGE.md)
- 📄 [0.4.5a 改动说明](docs/releases/0.4.5a.md)
- 🔄 [迁移状态与酒狐候选方案](docs/RUST-SLINT-MIGRATION.md)

---

## 🌟 RS 版本系列

| 版本 | Codename | 中文短语 |
|------|----------|----------|
| **RS0.1.0** | **First Light** | 初光 · 故事的起点 |
| **RS0.2.0** | **Resonance** | 共鸣 · 第一次理解（当前） |
| RS0.3.0 | Connection | 连接 · 跨越距离 |
| RS0.4.0 | Echoes | 回响 · 留下的记忆 |
| RS0.5.0 | Awakening | 觉醒 · 新的可能 |
| RS0.6.0 | Starlight | 星光 · 黑夜中的指引 |
| RS0.7.0 | Daybreak | 破晓 · 漫长黑夜的尽头 |
| RS0.8.0 | Beyond | 彼岸 · 越过已知的边界 |
| RS0.9.0 | Reverie | 绮梦 · 关于未来的想象 |
| RS1.0.0 | Tomorrow | 明天 · 新旅程的开始 |

完整版本系列定义见 [rs-version-series.json](docs/rs-version-series.json)。

---

## 📌 重要约束

### 不可破坏的运行约束

- ✅ IPC 只监听回环地址，必须使用随机令牌
- ✅ 自动回复首次默认关闭（用户保存后才启用）
- ✅ 密钥不能进入配置、日志、主题包、清单
- ✅ 模型首轮失败才允许故障备选（已发生副作用后不能盲目重试）
- ✅ 取消、超时、关闭必须释放任务、网络、写队列、子进程
- ✅ 酒狐资源不进入 RS0.2.0 默认构建

### 开发禁止事项

- ❌ 不要把页面控件数量当成功能完成
- ❌ 不要把 Node 后端重新引入 QQAF 业务核心
- ❌ 不要把酒狐资源或 GPU 依赖塞进普通构建
- ❌ 不要直接打开旧 SQLite/V8 数据库来"快速兼容"
- ❌ 不要在无授权时创建 Release、推送 main 或替换旧标签

---

## 📄 许可证

项目本体的许可证信息见仓库根目录的 LICENSE 文件。

**第三方资源**：
- 模型厂商 Logo 的来源与商标说明见 [资源来源](app/ui/assets/model-logos/SOURCES.json)
- SnowLuma 是外部组件，遵循其自身许可证，详见 [数据、安全与第三方边界](docs/06-data-security.md)

---

## 🔗 相关链接

- 📦 [GitHub 仓库](https://github.com/N1v4lis/QQARCFOX)
- 🎯 [Milestones](https://github.com/N1v4lis/QQARCFOX/milestones)
- 🏷️ [v0.4.5a 归档 Release](https://github.com/N1v4lis/QQARCFOX/releases/tag/v0.4.5a)
- 📋 [功能迁移清单](docs/NATIVE-FEATURE-MATRIX.md)
- 🔄 [RS0.2.0 验收进度](docs/RS0.2.0-ACCEPTANCE.md)

---

**注意**：本项目处于架构重构的关键阶段，当前版本为实验性质。功能完整性和稳定性仍在持续改进中，不建议在生产环境使用。欢迎开发者参与测试和反馈。
