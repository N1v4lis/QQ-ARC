# 酒狐与雪狐最终交付包

先阅读 [酒狐桌宠实现与Agent交接.md](酒狐桌宠实现与Agent交接.md)，把本文档和整个文件夹一起交给其他 Agent。

- 最新 Blender：`Models/Blender/winefox-large-lever.blend`、`snowfox-large-lever.blend`。
- 最新网页/跨应用模型：`Models/GLB/` 中对应的两份 GLB，纹理与动画内嵌。
- 双角色全动作演示：双击 `WebDemo/启动演示.cmd`，地址 http://127.0.0.1:8777/ 。
- 酒狐桌宠参考：双击 `WebPet/启动桌宠.cmd`，地址 http://127.0.0.1:8776/ 。
- 转换与修复参考源码：`Reference/`；验证记录：`Verification/`；预览：`Previews/`。
- 文件完整性：`MANIFEST.json`。

两种角色各 46 个动作，七套表情，默认跟随动画；死亡和游戏失败自动呆住。雪狐嘴型已修复，尾巴与耳朵摆动、双向拉杆也已纳入。桌宠半隐藏 UI，2 秒内轻点 3 次生气，6 秒不点恢复。

网页运行需 Node.js；正常浏览无需安装 npm 依赖。真正透明桌面窗口与输入穿透需目标宿主实现。来源与许可见 `Models/*/SOURCE.txt`。原项目与旧 Finish 保留，本目录是最新独立副本。
