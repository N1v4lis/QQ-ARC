# 酒狐与雪狐桌宠：最新成品与 Agent 实现交接

整理日期：2026-10-07。原项目：`E:\CodeX-YSM`；交付目录：`E:\CodeX-YSM\Finish-end`。

这份文档交接当前已经实现的模型、网页、转换方法和验证证据，供其他 Agent 在其他应用中实现酒狐桌宠。优先使用本包的最新资产，不要依据旧 `Finish` 文档中的 44 动作、默认表情 0 或“GLB 加载后只显示普通嘴型”等旧规则实现。

## 1. 从这里开始

| 相对本目录的路径 | 用途 |
|---|---|
| `Models/Blender/winefox-large-lever.blend` | 最新酒狐 Blender 成品，46 个动作、七种表情及自动嘴巴 |
| `Models/Blender/snowfox-large-lever.blend` | 最新雪狐独立副本，已修复透明嘴型贴图 |
| `Models/GLB/winefox-large-lever.glb` | 新应用推荐使用的酒狐模型，纹理、骨骼、动画、morph 内嵌 |
| `Models/GLB/snowfox-large-lever.glb` | 对应雪狐网页/跨应用模型 |
| `Models/Textures/` | 原酒狐、雪狐贴图及补齐嘴型后的雪狐专用面部图集，供检查；GLB 运行不需外部贴图 |
| `WebDemo/` | 最新双角色全动作演示，手动/逐个播放、进度、速度、表情、嘴巴及拖拽 |
| `WebPet/` | 接入最新酒狐模型的桌宠网页，半隐藏 UI、拖动、连续点击生气及自动消气 |
| `Previews/` | Blender 表情样本与左右拉杆交替预览 |
| `Verification/` | 模型和网页验证记录、截图，以及本交付包的新运行检查 |
| `Reference/source-pack/01_taisho_maid/` | 用户实际提供的 Minecraft Java 1.21.1 Fabric YSM 模型包 |
| `Reference/OpenYSM-code/` | 用于理解游戏动画层及表达式的缓存源码摘录 |
| `Reference/TestScripts/` | 最新拉杆、尾巴、自动表情、雪狐贴图修复、导出和检查脚本 |
| `Reference/ConversionScripts/` | 原包读取、基础转换与动画核查代码 |
| `Reference/OriginalConversion/` | 早期转换记录、原脚本及原始报告，作为历史依据 |
| `MANIFEST.json` | 所有交付文件的字节数与 SHA-256 |

两份主模型都有 46 个命名动画：44 个保留动作，加 `lever_left_to_right` 与 `lever_right_to_left`。两个拉杆方向是同一文件内的独立 Action，不是两份模型。当前导出骨骼为 203 个：195 个基础骨骼、1 个拉杆控制骨骼、7 个 FaceMode 表情骨骼。每个 GLB 片段包含 609 个骨骼 TRS 通道和 7 个面部 morph 通道，共 616 个通道。

网页运行需要 Node.js：双击 `WebDemo/启动演示.cmd`（端口 **8777**）或 `WebPet/启动桌宠.cmd`（端口 **8776**）。也可进入对应目录运行 `node server.mjs`。Three.js 已本地打包，正常运行不需要 npm 安装或 CDN；不要直接双击 HTML 使用 file:// 加载 GLB。自动化浏览器检查才需要安装 Playwright，并按本机环境调整 Chrome 路径。

## 2. 用户已确定的交互

桌宠可以拖动，松手保留位置；拖动不算轻点。半隐藏设置入口默认贴在页面右边缘，打开后可选择动作、表情、大小和暂停，Esc 收起。

轻点一次，短暂显示开心表情和文字；在滚动的 **2 秒时间窗口内轻点 3 次**，显示原模型的 💢 和对应生气嘴型，不停止身体动作。生气期间继续点击会延长计时；**6 秒不点击**后恢复基础表情。最新版基础表情默认是 `-1` 自动，跟随当前动作，不再固定为普通微笑。

表情优先级：交互生气 > 打招呼开心 > 用户手动表情或动作自动表情。手动修改基础表情会清空交互计时和点击记录。身体暂停时，情绪计时仍按真实单调时钟继续。

`WebDemo` 与 `WebPet` 有意采用不同的轻点行为：演示网页点击角色随机播放其他动画，桌宠网页轻点只触发上述情绪，不强制改变身体动作。桌宠目前展示酒狐；雪狐 GLB 已提供，可按双角色演示的加载方式接入目标应用。

## 3. 来源、坐标与转换链

最初下载的 Blockbench 模型不一定与用户游戏中的版本相同。后续修复以本地 `01_taisho_maid` 模型包为依据，它不是 `.bbmodel` 文件，包含：

```text
models/main.json       骨骼层级与立方体几何
animations/*.json      关键帧、Molang 表达式及辅助动画层
controller/*.json      游戏动画状态控制
textures/skin.png      酒狐贴图
textures/skin_white.png 雪狐贴图
ysm.json               包配置
```

原几何约有 195 根骨骼、490 个立方体。读取原包生成中间结构，再建立网格、box UV、像素材质、骨骼、逆绑定矩阵和蒙皮；动画以 30 fps 烘焙，补齐独立片段中所有骨骼的默认 TRS，避免动作切换时遗留上一片段的姿态。原报告记录 103 个源动作、94 个可导出变换动作，删去指定条目后得到 44 个，再新增两个拉杆动作。

基础转换使用源位置 `(-X,+Y,+Z)/16`，旋转 `(-X,-Y,+Z)` 并与静态骨骼旋转组合。glTF 是 Y-up，导入 Blender 为 Z-up；成品 Blender 面朝 +Y，对应成品 glTF 前方 -Z。网页相机从 -Z 看向模型。已转换的 GLB 不要再执行这套源坐标变换，也不要为了修某个尾段而翻转整个模型。

UV 保留源立方体各面的排布、镜像和 east/west 面关系。像素贴图用最近邻采样，关闭 mipmaps；播放动画无需逐帧重算 UV。

对照的 [OpenYSM 仓库](https://github.com/OpenYSM/OpenYSM) 源码用于理解关键帧插值、pre/post、表达式和并行动画层。缓存摘录来自当时取得的代码，早期记录指向 `1.20.1-forge` 分支，不能据此声称完整复现 1.21.1 Fabric 运行时。

## 4. 动画规则与长度

每个动作都是独立片段，运行时从实际 `gltf.animations` 构建菜单。完整名单和时长见文档末尾及 `Verification/Models/library-glb-report.json`。不能把多个完整姿态动画同时全权混合。

切换时先停止旧动作，再 reset/play 新动作。当前采用直接切换，没有交叉淡入淡出：隐藏部件使用零或近零缩放，随意混合会让隐藏的嘴型、形态或道具在身体中穿行。其他引擎若要增加过渡，需逐对验证。

```js
mixer.stopAllAction();
currentAction = mixer.clipAction(selectedClip);
currentAction.reset();
currentAction.setLoop(THREE.LoopRepeat, Infinity);
currentAction.play();
mixer.update(0);
// 然后恢复自动面部轨道、应用手动覆盖，最后更新世界矩阵。
```

不要把“没有长度限制”理解成删除片段的固有时长。当前关闭 Blender `scene.use_preview_range` 和所有 `Action.use_frame_range`，场景范围覆盖实际关键帧（目前 0～1488），导出设置 `export_frame_range=False`。新增 20 帧动作不得将全局范围缩成 20 帧；其他动作按自己的完整时长播放。

GUI 名称保持 `gui`，30 fps，0～540 帧即 18 秒。雪狐已同步酒狐 120 帧之后较丰富的 GUI 面部与骨骼表现，并保持名称、帧率和总长度。

原删减要求继续有效：删除 `pre_parallel1～4`、`parallel1`、`parallel5`、所有 `vehicle*`、`ride`、`ride_pig`、所有 `tac*`、所有 `carryon*`、`chair`、`gomoku`。辅助行为已烘焙进身体动作，不要为了恢复尾巴而把这些条目重新加入菜单。仍保留的 `head:default` 和 `pre_parallel0` 是辅助片段，菜单可展示，自动宠物行为一般无需随机选择它们。

动画时间单位为秒：30 fps 是烘焙采样率，不是要求显示器每秒只绘制 30 次。渲染时使用 `mixer.update(dtSeconds)`，速度调节使用 timeScale。网页速度倍率与历史的飞行身体倾斜控制不是同一功能。

## 5. 飞行、尾巴与耳朵

用户要求人形飞行时尾巴旋转，不是变成小狐狸。早期曾手工构造旋翼，出现尾巴在身体内旋转、尾尖固定尾根转等错误；不要复用早期试验文件。最新 fly 沿用后续实际游戏包修正后的骨骼与动作，最近的全库尾巴修复排除了 fly，逐项保持其原 pose 曲线不变。

非 Fly 尾巴检查以局部旋转为准，不能把身体整体带动尾巴当成摆尾。32 个原本静止的身体片段补入尾巴运动，10 个已有运动片段保留，包括两个拉杆。死亡保持静止尾巴，`head:default`、`pre_parallel0` 不强加摆尾。

原游戏中 `pre_parallel2` 生成 `v.tail*y/z` 的三秒周期驱动，`parallel3` 设置弹性参数 F=2、C=0.8、R=20，`parallel4` 以 0.01 秒步长更新弹性位置和速度。删除辅助片段后，独立动作失去这些运行时变量。现在将稳态弹性响应烘焙进身体动作，而不是重新保留所有游戏控制器。

普通尾巴源周期三秒；较短循环取整周期数，以实际片段时长调整周期，保持首尾闭合。sleep、elytra_fly 降低振幅并保留折尾姿态。原本仅一帧、但源定义为循环站姿的静态片段扩为三秒以承载摆尾。

拉杆动作尾根摆幅约 28°，后续尾节约 3～9° 并带相位延迟，另有小幅上下晃动；耳朵约 9° 摆动。两个方向的尾巴相位衔接，交替播放时连续。

## 6. 拉杆动作与道具

两个拉杆片段各 0～20 帧、30 fps、约 0.667 秒。角色与拉杆同一个 Action，`Lever_Control` 驱动道具，没有需要另外同步的道具动画。模型中保留完整原动作库。

单向片段端点不同，不应独立 Repeat 后宣称无回跳。开启循环时先左到右，再右到左，约 1.333 秒完成往返。单次播放可以 LoopOnce 并保持终点。

道具网格：`Lever_*`、`Base_Bolt*`、`Travel_Stop*`、`Grip_Endcap*`。非拉杆动作将这些网格统一 visible=false；拉杆动作统一显示。不能只隐藏 Lever 前缀，否则地上会留下螺栓、限位块和握把端帽。

曾修复手与拉杆接触、手臂和袖子、裙摆及脚位：手掌按真实可见前臂立方体计算接触面，并按当前姿态求支撑距离，约留 1 mm 间隙；肩部与袖口作相应位置修正；裙摆以站姿世界姿态补偿身体倾斜；脚保持固定。IK 或接触计算使用骨骼真实关节 `bone.head`，不能假定 Blender `bone.tail` 与源模型下一关节重合。

验证报告检查了两个方向共 42 个逐帧姿态、1032 个裙摆顶点、手掌接触及道具交叉。原模型隐藏的衣服内部搭接和肩部接缝未当作必须消除的交叉；不代表所有 46 个动作的所有几何都通过零穿模证明。

## 7. 表情、嘴巴与雪狐贴图

| 模式 | 显示含义 | 节点 |
|---|---|---|
| -1 | 自动，跟随当前片段；运行时模式，不是第八套网格 | — |
| 0 | 普通，闭嘴微笑 | `Normal_Mouth` |
| 1 | 开心，张嘴笑 | `Happy_Mouth` |
| 2 | 生气，💢 与嘴型联动 | `Anger_Mark` |
| 3 | 紧张，锯齿嘴 | `Wave_Mouth` |
| 4 | 惊讶，大张嘴 | `Surprise_Mouth` |
| 5 | 小张嘴 | `Expression5_Mouth` |
| 6 | 呆住，方眼 | `Expression6_Mouth` |

原 `Mouth_chill` 是锯齿嘴，不是普通嘴型；普通使用闭嘴微笑。表情从身体中拆成七个独立网格，避免嘴型叠加。生气套装包含嘴部和原 💢 标志。历史处理中蓝点是 Expression_5 内独立立方体、UV 起点 `[144,61]`，删除对应几何而不删整个嘴型；当前成品均从去蓝点基础模型派生。

最新版每个面部网格 100% 权重到对应 `FaceMode_0～6` 骨骼，七根骨骼都是 Head 的子骨骼，保留绑定位置。不要继续使用旧版“所有表情只绑 Head、仅靠 visible”的控制方法。

Blender 骨架属性：`表情=-1` 自动，`表情=0..6` 手动；`嘴巴张合=-1` 自动，`0..1` 手动。`自动表情` 与 `自动嘴巴` 由每个 Action 写入，不是用户主开关。面部对象有可见性驱动，FaceMode 骨骼有缩放驱动，每套面部有 `Mouth_Open` 形态键。嘴型变形只拉伸嘴部区域，不拉伸眼睛与头顶标志。

自动表情结合源 Mouth/Expression 通道推导，部分动作使用合理回退，GUI保留多个表情阶段。最新明确规则：**death 和 game_lost 全程模式 6「呆住」**，优先于源嘴型通道；手动选择仍可覆盖。它们只修改自动表情关键帧，身体、自动嘴巴、帧数与帧率不变。

雪狐曾完全看不见嘴巴：skin_white.png 在这些嘴型 UV 上透明，骨骼与驱动验证通过仍无法显示。现已建立 `SnowFox_Face_Atlas`，仅将七套表情所用 UV 区域中“原酒狐可见、雪狐透明”的 63 个像素补回；身体仍使用 skin_white.png，不改变雪狐头发、衣服整体配色。贴图打包入 .blend 和 GLB，并提供外部 PNG。验证必须检查实际 UV 像素 alpha 和渲染，不能只检查 visible 或驱动值。

## 8. 跨应用表情更新顺序：关键实现

GLB 已烘焙 FaceMode 缩放和嘴巴 morph 通道；extras 的 `expressionMode` 被 Three.js 映射到 userData。自动模式下保持七个表情网格 visible=true，由动画中各 FaceMode 的缩放决定实际显示。手动模式才限制可见网格，并覆盖选中的骨骼缩放为 1，其他为近零。

每帧必须按顺序：身体 mixer 更新 → 恢复当前动画的自动面部缩放和 morph → 根据交互/手动状态覆盖 → 更新世界矩阵 → 命中或渲染。

Three.js PropertyMixer 会跳过未变化属性的写入。手动设置后，暂停时直接回自动，单独 `mixer.update(0)` 可能留下旧状态。当前网页在切换动作时为该片段的面部轨道创建 interpolant，每帧按 action.time 明确采样，所以暂停与进度拖动也能正确恢复。不要只把所有网格显示回来。

核心实现可直接照抄 `WebDemo/dist/app.js` 中的 `play`、`updatePose` 和 `applyExpression`，或 `WebPet/dist/app.js` 的 `play` 与 `applyExpression`：

```js
// 动作切换时准备一次。
const faceTracks = [];
for (const track of selectedClip.tracks) {
  const parsed = THREE.PropertyBinding.parseTrackName(track.name);
  const node = THREE.PropertyBinding.findNode(model, parsed.nodeName);
  if (node && ((faceBones.includes(node) && parsed.propertyName === 'scale') ||
      (faceMeshes.includes(node) && parsed.propertyName === 'morphTargetInfluences'))) {
    faceTracks.push({node, property: parsed.propertyName, sample: track.createInterpolant()});
  }
}

function updateFace(mode = -1, mouth = -1) {
  // mixer.update(dt) 已完成。先恢复自动值，避免属性缓存留下手动覆盖。
  for (const binding of faceTracks) {
    const value = binding.sample.evaluate(currentAction.time);
    if (binding.property === 'scale') binding.node.scale.fromArray(value);
    else for (let i = 0; i < value.length; i++) binding.node.morphTargetInfluences[i] = value[i];
  }
  for (const mesh of faceMeshes) {
    mesh.visible = mode < 0 || Number(mesh.userData.expressionMode) === mode;
    if (mouth >= 0 && mesh.morphTargetInfluences)
      mesh.morphTargetInfluences[0] = THREE.MathUtils.clamp(mouth, 0, 1);
  }
  if (mode >= 0) for (const bone of faceBones)
    bone.scale.setScalar(Number(bone.name.slice(-1)) === mode ? 1 : 0.00001);
  model.updateMatrixWorld(true);
}
```

其他引擎需实现等价顺序。若导入器丢掉 extras，按上表节点名建立模式映射。骨架和表情蒙皮必须保留；不要把面部当成不跟随 Head 的静态贴片。Blender 可见性驱动不会自动成为 Unity/Godot 的驱动，要用目标引擎运行时控制。

## 9. 桌宠输入与情绪状态机

时间戳使用单调时钟 `performance.now()`，身体动作 dt 与情绪时钟分开。避免多个旧 setTimeout 写表情覆盖新生气状态。

```js
function effectiveMode(now) {
  if (now < angerUntil) return 2;
  if (now < greetingUntil) return 1;
  return userExpression; // -1 表示交给当前动画。
}
function onPetClick(now) {
  clickTimes = clickTimes.filter(t => now - t <= 2000);
  clickTimes.push(now);
  if (now < angerUntil || clickTimes.length >= 3) {
    angerUntil = now + 6000;
    greetingUntil = 0;
    clickTimes = [];
  } else greetingUntil = now + 1800;
}
```

pointerdown 命中可见模型才开始跟踪，保存 pointerId、按下位置、角色位置和射线与拖动平面的交点，调用 setPointerCapture。位移超过 6 CSS 像素进入拖动；pointerup 没拖过才算一次点击。pointercancel 和 lostpointercapture 清理状态，不增加点击。鼠标与触摸使用相同 Pointer Events，canvas 设置 touch-action:none。

射线前更新世界矩阵与 skeleton，蒙皮几何会移动，不能用导入时的静态包围球。不可见网格要排除。桌宠采用正交相机、Z=0 拖动平面；角色位置限制在页面内。文字气泡跟随 Head 的世界位置投影到屏幕，UI 面板默认收起。

网页是浏览器内宠物。真正桌宠由宿主层提供透明无边框窗口、置顶、屏幕坐标与窗口拖动、空白区域鼠标穿透、展开面板时的输入区域和多屏 DPI。宠物情绪、模型动画和窗口输入应分层，不要用“隐藏 UI”代替“窗口穿透”。本包没有提供原生窗口桥接代码。

## 10. 渲染和集成顺序

用 GLB 导入完整场景并在根创建 AnimationMixer，包含角色与拉杆。播放 idle 后，用实际可见且非退化的蒙皮三角面测尺寸，不要让零缩放隐藏部件扩大包围盒。最近邻贴图、roughness≈0.85、metalness=0，透明 canvas 配置配合宿主透明窗口。

先验证 idle、walk、fly、gui，再接入手动/自动表情、嘴巴及 death/game_lost。随后实现拖动与情绪窗口，再接入半隐藏 UI、宿主窗口和鼠标穿透。拉杆按两个方向交替；所有菜单与时长读取模型实际数据。

可以为目标应用定义 `setAnimation(name)`、`setExpression(-1..6)`、`setMouth(-1..1)`、`setPlaybackSpeed(multiplier)`、`setPaused(bool)`、`onClick(now)` 和 `onDrag(delta)` 等接口。禁止用动作播放时长作为消气计时，也不需要烘焙 46×7 套身体动作。

## 11. 如何重建与哪些脚本不能直接运行

本包成品可直接使用。Reference 内脚本保留原路径上下文，是阅读/移植参考，不保证拷到任意目录后直接一键重建。

原项目主链：读取实际游戏包 → 基础 GLB/Blender 动画转换 → OpenYSM 语义核查 → 独立动作默认姿态与删减 → 去蓝点、七套表情 → `create_lever_actions.py` → `audit_tail.py` → `enhance_library.py`（尾巴、自动表情、雪狐副本与面部图集）→ `verify_library.py` → `export_library.py`。

`fix_snow_mouth.py` 修复已生成的雪狐嘴型贴图，已集成到增强脚本末尾。`fix_sad_expressions.py` 对现成主模型仅修 death/game_lost 自动表情；规则也已写入增强脚本。`verify_snow_mouth_pixels.py` 检查 UV 透明度。`close_tail_loops.py` 的短循环闭合逻辑已经整合，不必重复执行。`final_checks.py` 做拉杆几何检查，但还会处理导出文件，不能当成完全只读检查。

`create_lever_actions.py` 原来读取 `../Finish/Models/Blender/winefox-animated.blend`（44 动作基础成品）；不要把本包已含拉杆与 FaceMode 的 46 动作模型直接作为它的基础输入重复加骨骼。先理解脚本并重设输入/输出路径。其他脚本也引用原项目的 Test、01_taisho_maid、Finish 或网页目录。检查脚本中绝对/相对路径后再写目标应用构建脚本。

Blender 5.2.2 使用 Action Slots，脚本指定 Action 后需正确匹配 `animation_data.action_slot`。排查动画选择时可关 `use_nla` 并设置活动 Action，或在 NLA 只 Solo 对应条目；不要同时打开所有轨道。导出使用 GLB、NLA_TRACKS、完整骨骼采样、extras、morph 动画，并避免按场景范围截断。导出后修正蒙皮节点的身份父级以消除 glTF 验证警告。

## 12. 证据与边界

`Verification/Models/library-verification.json` 是全库验证，两个模型共 2304 个采样帧/表情兼容场景；验证有限坐标、可见性、驱动、嘴巴及 GUI 同步。`verification.json` 是拉杆逐帧接触与穿模检查。`snow-mouth-opacity-verification.json` 增加实际贴图 alpha 检查。`sad-expression-verification.json` 在两个动作的起点、中点、终点验证自动呆住与手动覆盖，并证明其余曲线未变化。

`Verification/WebDemo/full-library-results.json` 检查两个角色全部 46 动作、每个动作自动和七种手动表情、暂停时回自动、GUI时长、拉杆交替、逐个播放和移动布局。`sad-expressions-results.json` 专门验证最后的 death/game_lost 规则。网页检查并非对所有动画逐帧人工渲染。

两份最新 GLB 均经 glTF Validator 检查为零错误、零警告。交付副本另通过文件哈希、GLB结构及打包网页运行检查。新增的 WebPet 当前版以最新酒狐 GLB 为基础，交互测试报告区别于历史 44 动作桌宠。

交付包实际运行证据：`Verification/WebPet/verification.json` 检查拖动、半隐藏UI、2秒点击窗口、3次生气、6秒恢复、手动表情与手机布局；`Verification/package-runtime-checks.json` 检查最新桌宠46个动作×自动及七种手动表情，以及死亡/失败呆住与道具显示。`Verification/PackageWebDemo/` 保存交付包双角色演示的交互与最终表情规则复测。端口实际使用8777（演示）和8776（桌宠）。

Minecraft 控制器层、设备状态、装备、声音、粒子和实时 Molang 未完整迁移。缺失变量在基础转换中可能使用默认值；原转换报告包含一条带多余右括号的表达式回退，不应宣称所有源通道均无损。烘焙尾巴是稳态响应，不是完整实时物理模拟。fly、其它动作原游戏的环境反馈，也不由静态 clip 自动还原。

历史飞行速度控制版曾用独立 `飞行控制器` 给 AllBody 额外前倾，速度0/10/20对应约0/15/30°；它基于更早的部分通道动作库，不属于本包最新主模型。参考脚本保留用于阅读，若需要应移植到最新骨架并重新验证，不能用旧模型替换当前主成品。

## 13. 许可与后续维护

模型作者与 CC BY-NC-SA 4.0 许可见 `Models/*/SOURCE.txt` 和原包说明。复制/修改保留署名、来源及相应许可；该模型不适合在未取得额外授权的情况下直接用于商业桌宠。Three.js 许可随 vendor 保留。

WineFox 与 SnowFox 必须是独立副本，不能以雪狐贴图覆盖酒狐。不得恢复已删动作，不得用短动作裁剪整个库，不得无依据改动 fly。后续修改先验证源动画/几何/贴图再下结论；驱动通过不等于实际渲染正确。每次更新同步 .blend、GLB、实际网页使用副本和 manifest，记录明确的已测范围。

## 14. 当前完整动作清单

下表由当前 GLB 导出报告生成，帧跨度为时长×30（起点为 0，端点包含；不是采样点数量）。

| 动作原名 | 秒 | 帧跨度 |
|---|---:|---:|
| `attacked` | 0.5 | 15 |
| `beg` | 0.5 | 15 |
| `boat` | 3 | 90 |
| `climb` | 1 | 30 |
| `climbing` | 3 | 90 |
| `death` | 1 | 30 |
| `elytra_fly` | 0.5 | 15 |
| `extra0` | 3 | 90 |
| `extra1` | 1.5 | 45 |
| `extra2` | 1.5 | 45 |
| `extra3` | 36 | 1080 |
| `extra4` | 22.97 | 689 |
| `extra5` | 0.5 | 15 |
| `extra6` | 0.6667 | 20 |
| `extra7` | 1.367 | 41 |
| `fly` | 0.7333 | 22 |
| `game_lost` | 3 | 90 |
| `game_win` | 3 | 90 |
| `gui` | 18 | 540 |
| `head:default` | 0.03333 | 1 |
| `idle` | 30 | 900 |
| `jump` | 0.7333 | 22 |
| `keyboard` | 49.57 | 1487 |
| `ladder_down` | 1 | 30 |
| `ladder_stillness` | 1 | 30 |
| `ladder_up` | 1 | 30 |
| `lever_left_to_right` | 0.6667 | 20 |
| `lever_right_to_left` | 0.6667 | 20 |
| `new_idle_1` | 6 | 180 |
| `new_idle_2` | 5 | 150 |
| `new_idle_3` | 6.5 | 195 |
| `new_idle_4` | 10 | 300 |
| `picnic` | 3 | 90 |
| `pre_parallel0` | 4 | 120 |
| `run` | 0.6667 | 20 |
| `sit` | 3 | 90 |
| `sleep` | 0.3667 | 11 |
| `sneak` | 3 | 90 |
| `sneaking` | 3 | 90 |
| `swim` | 1.3 | 39 |
| `swim_stand` | 1.3 | 39 |
| `swing_hand` | 0.3667 | 11 |
| `use_mainhand` | 0.3667 | 11 |
| `use_mainhand:gohei` | 0.6667 | 20 |
| `use_offhand` | 0.3667 | 11 |
| `walk` | 1 | 30 |
