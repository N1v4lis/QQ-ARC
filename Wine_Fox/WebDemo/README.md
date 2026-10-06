# 酒狐与雪狐全动作演示

双击 `启动演示.cmd` 或运行 `node server.mjs`，打开 http://127.0.0.1:8777/ 。需要 Node.js；Three.js 与两份 GLB 均已本地打包。

每个角色46动作，支持手动选择、逐个完整演示、暂停、速度与进度、自动/手动表情和嘴巴张合。拖动角色移动，轻点随机动画；拖空白旋转，滚轮缩放。拉杆循环左右交替，道具只在相关片段显示。

运行不需要 npm install。浏览器检查才需要 Playwright：npm install，然后运行 verify-browser.mjs、verify-full-library.mjs 或 verify-sad-expressions.mjs，Chrome 路径可按设备修改。
