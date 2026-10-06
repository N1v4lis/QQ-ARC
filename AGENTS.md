# 项目协作约定

动手前读 README.md、docs/HANDOFF-WILL.md 和 docs/CODEX-MIGRATION.md；
按改动范围继续读 ARCHITECTURE、DEVELOPMENT、TESTING、THEME-SYSTEM、PITFALLS。

- 工作区：E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next。旧目录保留为迁移备份及 DSH 现有链接目标。
- 原生 ES 模块，无构建工具、无 npm 安装步骤。Node 22+。
- 不改安装目录 resources/app/ui；新 UI 只部署至 ui-next。开发服务器使用 3400，代理宿主 3210。
- 保留原生功能及 DOM 契约；无边框、自绘标题栏；亮暗两档；默认与 MC 两种皮肤。
- 2026-10-07 用户明确提出后续将酒狐作为主题互动宠物。最新资源位于 Wine_Fox，读 docs/WINE-FOX-INTEGRATION.md。旧运行时仍未注册；后续用最新 GLB 和 WebPet 逻辑接入，并将删除守卫改为启停验收。
- 不裁剪用户素材、动画，不编造角色设定。遵守 MC 字体链和音效用途约定。
- JS 修改后检查语法。实际 UI 变更按部署流程执行，再跑全量回归。
- CSP 检查用 node tools/csp-hash.mjs；写回需要 --write。
- 改行为同步专题文档；design-notes.md 只追加，历史记录不批量改写路径。
- VERSION 是本 UI 分支版本；宿主 0.4.0 与 UI 分支版本分别记录。首次 UI 基线为 0.4.0，尚未发布。
- GitHub 目标仓库：N1v4lis/QQARCFOX，私有，描述 A modern, beautifully designed QQ Agent.。提交身份 N1v4lis <487271667@qq.com>；上游 Kondius/qq-agent 不等于用户的发布仓库。
- 发布前检查差异、素材许可及敏感配置；只提交源码、工具、文档和必要资产。
- 自动 QQ 回传来自原 DSH 桥接的既有机制，本会话不会自动使用它发送消息。
