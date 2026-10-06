# 最新酒狐桌宠网页

双击 `启动桌宠.cmd` 或运行 `node server.mjs`，打开 http://127.0.0.1:8776/ 。需要 Node.js，Three.js 与 GLB 已打包，不依赖 CDN。

采用最新酒狐模型，46 个动作；默认自动表情，死亡和游戏失败为呆住。拖动超过6像素不会误计轻点，2秒内3次轻点生气，6秒安静恢复基础表情。设置UI半隐藏，支持动作、七种手动表情、大小、暂停。拉杆自动左右交替，道具仅在拉杆动作显示。

这是页面内的桌宠参考。原生透明窗口、置顶和鼠标穿透由目标应用实现。核心状态机与最新面部轨道控制见 `dist/app.js`，完整交接见上级目录文档。`dist/models/winefox.glb` 与 `Models/GLB/winefox-large-lever.glb` 字节完全相同。

开发验证：npm install 后运行 node verify.mjs，调整脚本中的 Chrome 路径以适应其他设备。
