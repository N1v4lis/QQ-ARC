# 酒狐互动与双角色模型调整

2026-10-07，最新三阶段需求已替代上一版默认关闭、连续点击开心及拖动中断语音的规则。冷启动2秒、刷新1秒保持。

## 模型与动作

酒狐与雪狐使用 [衍生模型](../Wine_Fox/Models/Derived/README.md)。原始GUI以30fps烘焙，按120帧分为4秒gui与14秒gui2，两个模型均47片段。GUI原有全局展示骨骼将角色放大和偏移，造成半身；现在GuiRoot/MRoot沿用idle位置、旋转与尺度，Root原双倍尺度归一，身体与面部姿态关键帧保持。相机始终从idle全身拟合，避免受启动时选定动作影响。

原始GLB与Blender不改，调整发生于衍生GLB导出层；几何、材质、骨架和非GUI动作曲线保持。雪狐衍生模型一并更新，QQ主题当前只加载酒狐。菜单隐藏gui/gui2，45个动作可选，旧GUI偏好迁至idle。

run、walk、fly、swim、攀爬、sleep、picnic、keyboard等持续动作使用循环播放；death只播放一次。普通动作结束先恢复idle，再随机等待1–5秒播放其他动作。为保证循环动作也能进入下一轮自主活动，每次自主或手动持续动作播放两轮后恢复idle；拖动Fly和返回run持续至操作结束。开心互动动作只播放一次。

## 显示与互动

酒狐默认启用，但仅Minecraft主题创建模型。默认主题不显示、不加载；切离MC销毁渲染器、监听和音频，加载中切离也不会迟到创建。设置隐藏启用开关，宠物无右上角关闭按钮，保留语音、暂停、大小、位置及动作控制。

轻点随机使用现有开心动作：beg、extra2、extra5、game_win、jump、run。2秒内连续3次点击生气，使用sleep、picnic、sneaking及指定语音JaNai.ogg、Sato.ogg、Mo-Ya-Da.ogg。情绪状态5秒内再点击3次恢复开心；点击造成的生气6秒后自动恢复。

每次真实互动重新随机设置60–120秒闲置期限；超时随机变生气或呆住。生气池为sleep、picnic、sneaking；呆住池为game_lost、picnic、sneaking、keyboard。闲置情绪持续到多次点击恢复。keyboard上方DOM气泡循环显示“ご主人様…”，使用CSS动画，不改模型；气泡是宠物容器子元素，移动位置与角色一致。

正常拖动超过6px进入Fly，松开恢复idle并保存位置。情绪状态拖动不使用Fly，松开用run跑回拖动前原位，完成再恢复idle。拖拽按下、移动和松开均不中断正在播放的语音；新点击可切换单通道声音，关闭语音、切离MC或窗口隐藏停止声音。普通鼠标移动不做蒙皮射线，透明空白仍穿透，弹窗隔离保持。

## 语音与性能

原目录E:\!!!littleMaid_PECO完整复制为根Wine_Fox_PECO，105文件2571508字节，原文件保留，见[逐文件校验](wine-fox-interaction/voice-manifest.json)。运行仅保留10个eatSugar及3个指定生气OGG，用户交互时按需加载，一个Audio元素，不预解码整个目录，不放宽CSP。

仍使用局部WebGL画布、30FPS上限，暂停与隐藏停止持续绘制。闲置/动作调度用下一截止时间的单个定时器，不扫描每秒计数。新增气泡只用CSS，双模型不会同时进入QQ页面；默认主题无模型开销。本轮没有测整机CPU/GPU，不将浏览器验收当作整机性能结论。

## 生成与验收

生成顺序：tools/split-fox-gui.mjs → tools/prepare-wine-fox.mjs。tools/check-fox-gui-split.mjs验证两份模型、分割边界、全身展示变换、其他动作与部署副本；tools/check-fox-behavior.mjs用虚拟时间验证60–120秒范围、过量点击与恢复，不等待两分钟。

[本轮验收记录](wine-fox-interaction/phase-checks.json)。核心编号30的tools/check-wine-fox.mjs精简到22项，覆盖真实鼠标播放语音、拖动不中断、情绪拖动返回、循环/单次、idle等待与自主动作、主题清理、气泡及CSP。闲置浏览器场景仅用测试实例期限推进，不增加生产调试开关。完整原43套不恢复。

版本仍0.4.01，本轮仅本地开发与部署，不上传GitHub。历史记录保留在CHANGELOG及design-notes。
