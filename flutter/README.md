# QQAF Flutter 桌面界面

Flutter UI 与 Rust 核心的迁移开发版，不依赖 Electron、Node 或 WebView。旧客户端归档为 0.4.5a，实验包独立使用 0.1.0。

开发使用 Flutter 3.47.6 / Dart 3.13.5；Windows 构建还需要 Visual Studio C++ 桌面开发组件及插件所需的符号链接权限。

```sh
flutter pub get
flutter analyze --no-pub
flutter test --no-pub
flutter build windows --release --no-pub
```

构建 native/ 后将 qqaf-native.exe 复制到 build/windows/x64/runner/Release/，与 qqaf.exe 同级。分发须包含完整 Release 目录。开发运行可指定 QQAF_CORE_EXECUTABLE；QQAF_NATIVE_DATA_DIR 用于数据隔离，不能指定旧客户端数据库目录。

已接入总览、会话、模型设置、OneBot、手动记忆和主题偏好，读取核心真实状态。无账号时在 OneBot 页创建离线账号。连接和发送需手动触发，未实现自动回复。Minecraft 配色仅为界面验证，完整主题与酒狐尚未迁移。

Flutter 负责窗口与 UI，Rust 负责业务。IPC 使用随机端口和令牌保护的本机 HTTP。密钥仅保留在当前核心会话。酒狐默认关闭且禁用，Slint 或原生 3D 仍在考量。
