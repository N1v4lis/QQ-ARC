# Codex 接手、迁移与版本迭代

日期：2026-10-07（Asia/Shanghai）。

## 迁移结果

来源 `E:\QQ Agent Dev`，目标 `E:\CodeX-YSM\QQ Agent Dev`。
全部 10,726 个文件、1,595,203,842 字节复制完成，逐文件 SHA-256 相同。
包含隐藏文件、备份、截图、桥接插件、开发脚本和模型 / 壁纸素材，没有筛选掉资源。
校验完成后才添加接手文档和版本管理文件、修正当前操作指南与开发脚本路径。
历史编年史、备份及取证内容保留原始路径。

工作区根目录中的 `qq-agent-migration-sha256.csv` 保存来源文件的相对路径、大小、SHA-256；
`qq-agent-migration-verification.json` 保存验证摘要；`qq-agent-migration-copy.log` 保存复制日志。

原目录保留为迁移备份。目前 DSH 桌面 profile 的插件依赖仍为
`link:E:/QQ Agent Dev/dsh-dev-task-bridge`，所以旧桥接仍使用原目录。
新目录是后续 UI 开发主目录；桥接插件未来若也改用新目录，需要切换该 link 并重装本地链接依赖、重启 DSH、确认 revision。
本次没有更改 DSH profile 或正在安装的应用。

## 对之前工作流的理解

1. UI 在独立目录重构，沿用原逻辑层的 DOM 契约，原控制台保留以便回退。
2. Node 开发服务器从工作区直接提供静态文件，将 API 代理到正在运行的 QQ Agent。
3. 发布到本机时同步 CSP → 备份并镜像 ui-next → 恢复插件注入 → 验证重启 → 等就绪 → 全量回归。
4. 文档分为意图、架构、操作、测试、主题及踩坑；历史编年史只追加。
5. 另有 QQ → DSH 指令桥接：QQ 侧鉴权并作为 tasks.json 唯一写者；DSH 定向唤醒会话；
   结果经 HTTP 回传，由 QQ 侧渲染长图并回到原群或私聊。桥接详见资源根目录的 dsh-dev-task-bridge 交付说明。

## 当前边界与验证

- `E:\QQ Agent\resources\app\package.json` 的宿主版本为 **0.4.0**，上游地址为 Kondius/qq-agent。
- UI 目录原本没有 Git 仓库、package.json 或历史版本标签。本地 VERSION 采用 **0.4.0** 作为独立分支起点。
- 宿主后端及 QQ 侧安装插件不在来源目录中；现有补丁脚本不是完整后端源码。
- 完成部署预演、CSP 一致性检查、CSS 结构、文档引用、MC 音效、外壳标记和 Electron 外壳验证。
- 迁移检查时 QQ Agent 未运行，3210 不可达；完整 42 套在线回归尚未复验，不能把历史“全绿”当本次结果。
- CSP 工具默认只检查；原部署指南缺少 `--write`，已更正。

## 后续版本与 GitHub

当前 Git 仓库范围为 qq-agent-ui-next。其他资源完整留在资源根目录，不直接混入 UI 发布包。
用户已指定新仓库 **N1v4lis/QQARCFOX**，描述 **A modern, beautifully designed QQ Agent.**，
初始为 **私有**，后续可能公开。创建目标仓库后配置 origin；不要自动把上游仓库当作发布目标。
本机 Git Credential Manager 支持浏览器授权，无需下载 GitHub Desktop。
本仓库提交身份为 `N1v4lis <487271667@qq.com>`。浏览器授权已完成，私有仓库已创建：
https://github.com/N1v4lis/QQARCFOX 。origin 已配置，main 已推送并跟踪 origin/main。
首次迁移基线提交为 `1b70dbbb0d379d4948d7983762c0d70f92011d8c`，已核对远程 main 指向相同提交。
上传内容是 UI 仓库的 169 个文件；其余开发资源、备份和截图保留在本地完整迁移目录。
本次检查了 143 个文本文件中的常见私钥 / Token 特征，未发现匹配；该检查不等于完整安全审计。

每轮迭代：

1. 写明本轮目标及验收，修改工作区；同步对应专题文档。
2. 运行语法及针对性检查，在开发服务器验证。
3. 需要落地本机 UI 时走 DEVELOPMENT 中部署流程，然后执行完整回归，记录真实结果。
4. 更新 VERSION 和 CHANGELOG。修复用 0.4.1、0.4.2；新增成组功能用 0.5.0；破坏兼容的变更另定版本。
5. 审查 git diff，检查必要资产的来源 / 许可与敏感配置，然后提交变更。
6. 将通过验收的提交标记为 v0.4.0 / v0.4.1 等，推送分支和标签，在 GitHub Release 附验收与变更说明。

首个 v0.4.0 发布标签目前尚未创建。此次基线提交可先推送；
完整在线回归通过后才创建正式发布标签与 GitHub Release。
