# QQAF Flutter 桌面界面

Flutter UI + Rust 核心的 Windows 实验版，公开版本 **RS0.1.1 — First Light — 初光 · 故事的起点**，内部版本 0.1.1。旧客户端归档为 0.4.5a。所有后续开发在 Rust+Slint 分支进行，不覆盖旧安装和数据。

开发使用 Flutter 3.47.6 / Dart 3.13.5；Windows 构建需要 Visual Studio C++ 桌面组件及插件符号链接权限。用户运行无需工具链。

先在仓库根目录执行 tools/sync-flutter-assets.ps1，复制已跟踪的模型 Logo、Minecraft 背景/字体/音效，并生成像素图标。生成脚本用开发工具 Node，QQAF 运行时不使用它。

```sh
flutter pub get
flutter analyze --no-pub
flutter test --no-pub
flutter build windows --release --no-pub
```

构建 native/ 后，把 qqaf-native.exe 复制到 Windows Release 目录，与 qqaf.exe 同级。分发需完整目录，不能单独复制 exe。可用 QQAF_CORE_EXECUTABLE、QQAF_NATIVE_DATA_DIR 做隔离验证，不能使用旧数据库路径。

界面覆盖所有主导航和设置入口，接入核心实际状态。API与搜索使用平铺工作区；媒体草稿与自定义价格按模型隔离；人设保存当前栏及 Ctrl+S 不提交其他栏；配色禁用时仍可展开/收回；Minecraft 使用背景、字体、像素图标及实际开关拉杆；窗口控制按钮不播放点击音。酒狐开关禁用，没有装载其素材。

Windows 托盘和显式开机启动通过原生 runner 实现。默认不会注册启动项，用户在桌面端保存时才应用实验版启动项。关闭到托盘需用户打开，退出会终止 Rust 核心。外部 OneBot 不自动被终止。

**这不是完整旧版功能替代品。** 媒体执行、旧 JS 插件、完整主题包、主动话题、完整模板/市场管理及多 QQ 注入登录仍待移植。未迁移的执行选项在界面标注，不能以页面数量作为完成依据。具体边界见 [功能清单](../docs/NATIVE-FEATURE-MATRIX.md)。

Windows 从根目录用 tools/build-experimental.ps1 构建，传入 FlutterBinary 和所需 Rust 参数。脚本检查分支、同步素材、运行分析/测试、构建并打包到独立目录，附核心、VC 运行库、资源来源及许可证。未验证干净 Windows 安装和性能目标，实验包不等于正式安装器。
