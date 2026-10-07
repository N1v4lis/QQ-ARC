# 项目协作约定

动手前读 README.md、docs/HANDOFF-WILL.md 和 docs/CODEX-MIGRATION.md；
按改动范围继续读 ARCHITECTURE、DEVELOPMENT、TESTING、THEME-SYSTEM、PITFALLS。

- 工作区：E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next。旧目录保留为迁移备份及 DSH 现有链接目标。
- 原生 ES 模块，无构建工具、无 npm 安装步骤。Node 22+。
- 不改安装目录 resources/app/ui；新 UI 只部署至 ui-next。开发服务器使用 3400，代理宿主 3210。
- 保留原生功能及 DOM 契约；无边框、自绘标题栏；亮暗两档；默认与 MC 两种皮肤。
- 酒狐默认仅MC主题自动加载，启用开关与宠物关闭按钮隐藏。双角色Derived模型GUI/gui2全身展示，菜单隐藏GUI及jump；首项自然才自主动作/走跑飞并平滑朝向目的地及回头，手动循环持续、单次保持，Extra2结束归idle。呆住仅picnic/sneaking/keyboard都有左至右无缝气泡；每10秒平方增长至视口铺满，最多192格，宠物互动立即清空，继续不理60–120秒才恢复累积；转身平滑速度12；情绪动作周期20秒，生气10秒结束。自然闲置60–120秒随机情绪，连续点击生气，多点恢复；长按550ms圆形菜单含全部Extra0–Extra7；情绪拖动不Fly并run回原位，拖动不中断语音。完整声音Wine_Fox_PECO，见docs/WINE-FOX-INTERACTION.md，最新三阶段要求优先于旧文档。原始GLB/Blender保留，不恢复CPU光栅化。
- 不裁剪用户素材、动画，不编造角色设定。遵守 MC 字体链和音效用途约定。
- 启动动画遵守 docs/STARTUP-ANIMATION.md 与原要求：六阶段、同一粒子模拟、SVG掩膜、ARCFØX、第6阶段静止；亮暗切换不得重建几何。最新用户时长：冷启动2000ms、刷新1000ms，画布16:9；图标和文字粒子不可省略，速度有加速/收束，字母可见间隔一致。冷启动日志取实际状态；自动注入提示有条件且只读，不额外触发注入。宿主QQ检测补丁复用已有进程查询。
- JS 修改后检查语法。自动回归仅原编号1、2、3、5、30，用户明确停用其他38套，发布也不自动恢复。文档/工具改动跑static四项；酒狐改动补30。UI部署后最多core五项，失败只复跑失败项；见docs/REGRESSION-WORKFLOW.md。
- CSP 检查用 node tools/csp-hash.mjs；写回需要 --write。
- 改行为同步专题文档；design-notes.md 只追加，历史记录不批量改写路径。
- VERSION 是本 UI 分支版本；宿主 0.4.0 与 UI 分支版本分别记录。首次 UI 基线为 0.4.0；历史归档0.4.01保留；用户此次指定新版本0.4.1并授权打包上传本轮及上一轮。
- GitHub 目标仓库：N1v4lis/QQARCFOX，私有，描述 A modern, beautifully designed QQ Agent.。提交身份 N1v4lis <487271667@qq.com>；上游 Kondius/qq-agent 不等于用户的发布仓库。
- 用户2026-10-07最新要求：未经用户明确允许，不再自动上传GitHub，包括推送分支、标签、创建/更新Release；默认仅本地修改与验证。
- 发布前检查差异、素材许可及敏感配置；只提交源码、工具、文档和必要资产。
- 自动 QQ 回传来自原 DSH 桥接的既有机制，本会话不会自动使用它发送消息。
