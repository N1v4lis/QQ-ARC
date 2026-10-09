# 干净构建与安装包

默认图标、品牌 SVG、导航 SVG 和 Windows ICO 是仓库资源：`app/ui/assets/brand`、`app/ui/assets/default-icons`、`flutter/windows/runner/resources/app_icon.ico`。构建时复制 SVG 到 Flutter 声明的 assets，ICO 编译进 EXE；打包阶段不会重新设计或生成这些资源。

`clean-release` 是 Rust 编译特性，不是启动时的环境开关。此发行核心仅嵌入空白配置与空白人设模板，并使用独立的新架构数据目录，避免首次安装拾取实验测试数据。显式隔离测试目录仍支持开发工具的环境覆盖。

## 分开构建与打包

完整构建验证：

```powershell
./tools/build-clean-experimental.ps1 -FlutterBinary <flutter> -CargoHome <cargo> -RustupHome <rustup> -CompilerBin <compiler> -OutputRoot <output> -CreateInstaller
```

只打包已经完成的构建：

```powershell
./tools/build-clean-experimental.ps1 -BundlePath <verified-bundle> -OutputRoot <output> -CreateInstaller
```

第二条不调用 Cargo、Flutter、测试或资源生成；只检查资源和运行时，验证空账号/提供商/密钥/人设/消息/记忆/运行记录，复制文件并生成 ZIP、文件哈希清单、校验报告和安装器。

安装器为 Windows x64、当前用户安装，允许选择空目录，校验每个负载文件的 SHA-256。开始菜单、可选桌面快捷方式、系统卸载入口指向新图标；不注册自启，不启动 QQ、不迁入原数据。卸载只移除安装清单中的程序文件，保留账号/设置数据和不属于清单的文件；运行中的卸载器自身可手动删除。安装器需要 Windows 的 .NET Framework 4.x；本机测试不等于全新 Windows 环境兼容性验收。

安装器验证 `--verify` 不安装；`--extract-test <workspace _scratch path>` 只把负载解压到空测试目录，不创建注册表、快捷方式或启动程序。开发测试不得通过用户数据路径验证安装。

输出包含 Setup EXE、干净便携 ZIP、程序目录及 SHA-256 文件。包内仅包含程序、公共素材、依赖许可证和构建清单；素材来源 URL 不是提供商配置。所有测试缓存位于打包目录之外。

RS0.1.0 的资源、空白安装与关闭行为是交付点；完整业务恢复转到用户指定的 RS0.2.0 目标，功能矩阵仍记录未完成事项。


SnowLuma 分发边界：本安装包未附带 SnowLuma。OneBot 页面提供官方发行页入口，并支持用户准备的完整 Windows 组件目录（node.exe + index.mjs）；未指定目录时只检测程序旁的 components/snowluma 与 snowluma，不扫描旧安装。未准备时显示可操作的缺失状态，官方更新来源默认 SnowLuma/SnowLuma。随附 EULA 第 5.4 条要求将专有组件并入第三方安装包前取得书面授权，确认范围后再处理随包分发；当前不执行下载、部署或 QQ 登录。
