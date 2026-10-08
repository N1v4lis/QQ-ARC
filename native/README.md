# QQAF Rust 业务核心

配合 Flutter 的独立实验程序。实验包 0.1.1 与归档版 0.4.5a 分开，不覆盖旧客户端，不直接打开旧数据库。业务核心不使用 Node、Electron、WebView 或 Slint。外部 SnowLuma 的运行时属于用户自带 OneBot 组件。

开发需要 Rust 1.92+ 与目标平台链接器；用户无需 Rust 工具链。

```sh
cd native
cargo fmt --check
cargo test --locked
cargo build --release --locked
```

把 qqaf-native.exe 放在 Flutter Release 目录，与 qqaf.exe 同级。Flutter 启动核心，通过随机会话令牌保护的回环 HTTP 通信；绑定随机端口，拒绝浏览器 Origin。退出 UI 时关闭核心。开发可用 QQAF_CORE_EXECUTABLE 指定核心，QQAF_NATIVE_DATA_DIR 指定隔离数据目录；不要指向旧库。

各账号使用独立 SQLite WAL 和有界写队列。正常消息、记忆、用量、媒体/引用关联使用 SQL 字段；JSON 只用于配置、IPC、外部协议及显式官方导入。配置合并在账号写线程中执行，避免多个页面保存互相覆盖。OneBot 收件去重与消息同事务提交，重开保留。

agent.rs 实现每会话串行、有限合并的自动回复调度，账号间独立并发；自动回复默认关闭。白名单、屏蔽、活跃档位/峰谷与指令禁言参与运行。发送去重、间隔及分钟/小时限额按账号控制，不自动重试结果不明的发送。

模型支持 OpenAI 兼容接口及官方 Claude/Gemini 文本工具循环，首轮失败可换备选，工具执行之后不自动重播。每次成功返回的模型用量立即入库，后续失败不会删除已有计费；完成的手动对话正文成对事务提交。现为非流式文本工具链，不支持媒体、取消或完整旧工具集。使用实际返回的输入/输出 Token 估算；缓存/思考分项及历史重算待迁移。上下文最多 500 条、24000 字符，记忆 8000 字符，是字符预算，不是精确 Token 预算。

Windows 密钥经 DPAPI 加密保存；换 Windows 用户或设备不能保证解密。非 Windows 尚未实现凭据保险库。价格获取、网页读取、搜索、SnowLuma、官方 JSON 消息副本导入及扩展清单见 [功能清单](../docs/NATIVE-FEATURE-MATRIX.md)。旧 JS 扩展明确不能执行；用户启用的纯提示词技能可供工具循环使用。

测试用模拟模型和 OneBot，不向实际 QQ/模型发送消息。需要分别检查源代码、实际进程及 Windows UI；通过 mock 不代表第三方服务全部可用。GitHub 工作流文件存在不等于已成功运行 CI。酒狐完全排除，早期 slint-prototype 为可选候选，默认构建不含它。
