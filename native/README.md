# QQAF Rust 业务核心

配合 flutter/ 的独立迁移程序。默认构建不依赖 Node、Electron、WebView 或 Slint，不读取旧客户端数据库或密钥。实验包 0.1.0 不取代归档版本 0.4.5a。

开发需要 Rust 1.92+ 和目标平台链接器；用户运行无需 Rust 工具链。Windows MSVC 构建使用 Visual Studio C++ Build Tools；GNU 构建使用 MinGW。

```sh
cd native
cargo fmt --check
cargo test --locked
cargo build --release --locked
```

将 qqaf-native.exe 放到 Flutter Windows Release 目录，与 qqaf.exe 同级。Flutter 自动启动核心，通过随机会话令牌保护的本机 HTTP 接口通信；仅绑定 127.0.0.1 的随机端口，拒绝浏览器 Origin，启动输出不含凭据。关闭客户端时关闭核心。开发可用 QQAF_CORE_EXECUTABLE 指定核心，QQAF_NATIVE_DATA_DIR 指定独立数据目录。默认目录为系统用户数据区 QQARCFOX/native-prototype。

已实现每账号独立 SQLite WAL、有界串行写队列、正文 TEXT、游标分页、手动记忆、用量汇总、OneBot 正向 WS 文本收发和 OpenAI 兼容文本请求。完成的对话和用量同事务提交。上下文暂限最近 20 条消息、历史 24000 字符和记忆 8000 字符，是字符预算，不是精确 Token 预算。

密钥仅驻留内存，退出后需重新输入。模型请求使用 SSE，界面在完整响应后显示文本。真实请求仅由用户手动发送触发，没有自动 QQ 回复；QQ 客户端由用户提供。

未迁移旧 V8 数据导入、媒体/引用、多模态、工具、搜索、价格抓取、插件、人设、自动重连和完整主题。酒狐方案仍待验证，开关禁用。早期 slint-prototype 需显式 feature，仅为候选验证，默认构建不包含它，未完成渲染验收。

GitHub Actions 配置 Flutter + Rust Windows 开发包构建，安装器、运行库和干净系统部署另行验收。详情见 [迁移说明](../docs/RUST-SLINT-MIGRATION.md)。
