# 酒狐 / 雪狐：完整动作与拉杆测试（第五版）

## 当前成品

- winefox-large-lever.blend / winefox-large-lever.glb：酒狐。
- snowfox-large-lever.blend / snowfox-large-lever.glb：雪狐独立副本。

两份文件分别包含全部 44 个保留动作及 2 个拉杆动作，共 46 个。雪狐使用本地 01_taisho_maid/textures/skin_white.png；动作、骨骼、表情驱动和 GUI 与酒狐共用数据。Finish 中的基础成品与网页没有被覆盖。

lever_left_to_right 与 lever_right_to_left 是同一个模型内的两个 Action / NLA 条目，各为 0～20 帧、30 fps、约 0.67 秒。Lever_Control 骨骼控制拉杆，切换或独奏角色动作时，道具一起播放。左右交替循环约 1.33 秒，首尾姿态匹配。单方向首尾位置不同，不能直接 Repeat 同一个单向片段来获得无回跳循环。

尾根摆幅从 7° 提高至 28°，后续尾节加入 3～9° 的延迟摆动；另有少量上下晃动。耳朵加入 9° 左右的小幅摆动。摆动以动画时间计算，30 fps 播放，无逐帧累加速度，不受显示器刷新率影响。

## 无人为长度裁剪

关闭 scene.use_preview_range 和所有 Action.use_frame_range；场景范围覆盖全部真实动作关键帧，当前 0～1488。这不是让每个动作都变成 1488 帧，而是避免新增的 20 帧动作把 GUI、舞蹈等长动作裁掉。GLB 导出不按场景范围截断。以后新增短动作也不能缩短整个模型的播放范围，见 AGENTS.md。

GUI 的名字仍为 gui，30 fps，0～540 帧（18 秒）。雪狐以酒狐 GUI 为准，包含 120 帧以后原有的眉毛、眨眼及新增的自动嘴型表现。完整动作数据不改变 GUI 的时长。

## Blender 表情和嘴巴

death 与 game_lost 的自动表情固定为 6「呆住」，优先于原始动画中的嘴型通道。手动表情仍可覆盖；身体动作、嘴巴张合通道、动作长度与帧率不变。enhance_library.py 已同步该规则，已有模型可用 fix_sad_expressions.py 更新，验证见 sad-expression-verification.json。

选中骨架，在自定义属性中设置：

- 表情=-1：跟随动作自动切换。默认设置。
- 表情=0～6：强制选择普通、开心、生气、紧张、惊讶、小张嘴、呆住七种状态。
- 嘴巴张合=-1：跟随动作的自动嘴巴变化。
- 嘴巴张合=0～1：手动设置张合程度。

自动表情和自动嘴巴是 Action 驱动的内部属性；无需手动编辑。手动表情和嘴巴张合没有被身体动作曲线覆盖，因此兼容两个拉杆及其他全部动作。生气标志和生气嘴型由同一个表情状态控制。

七套独立面部网格保留。新增 FaceMode_0～6 骨骼负责选择状态，均为 Head 的子骨骼；网格带 expressionMode=0～6 元数据。每个面部网格另有 Mouth_Open 形态键；只改变嘴部区域，不拉伸头顶生气标志或眼睛。

## GLB / 其他应用

GLB 包含全部 46 个动画片段、自动表情的骨骼缩放通道和嘴巴的 morph weights 通道。默认自动模式不需要把其他表情网格手动隐藏：动画中的 FaceMode 骨骼负责隐藏/显示各状态。

手动表情覆盖要在每帧 mixer.update(dt) 之后执行，否则 AnimationMixer 会覆盖设置：

```js
function applyManualFace(root, mode = -1, mouth = -1) {
  root.traverse(o => {
    if (o.userData.expressionMode !== undefined) {
      o.visible = mode < 0 || o.userData.expressionMode === mode;
      if (mouth >= 0 && o.morphTargetInfluences) {
        o.morphTargetInfluences[0] = Math.max(0, Math.min(1, mouth));
      }
    }
    const match = /^FaceMode_([0-6])$/.exec(o.name);
    if (match && mode >= 0) {
      o.scale.setScalar(Number(match[1]) === mode ? 1 : 0.00001);
    }
  });
}
// mixer.update(dt);
// applyManualFace(gltf.scene, selectedMode, mouthAmount);
// gltf.scene.updateMatrixWorld(true);
```

返回自动模式时设 mode=-1、mouth=-1，恢复所有表情节点 visible=true，由下一次 mixer.update 使用动画值。不要使用旧版“永远只显示 expressionMode=0”的逻辑，否则自动表情切换时嘴巴会消失。

对整个场景创建 AnimationMixer，包含角色和拉杆骨骼。两个单向拉杆片段一次播放并保持终点，轮流切换即可循环。时间单位为秒；不要把帧编号直接作为 dt。

## 非 Fly 尾巴审计与修复依据

逐一检测了全部动作的尾巴局部旋转，避免把身体带动尾巴误判成摆尾。10 个已有运动的动作（含两个拉杆动作）保留原运动。32 个原本静止的身体动作补烘焙尾巴。death 保留死亡静止；head:default、pre_parallel0 是辅助轨道，不强加身体摆尾。Fly 的原有 pose 骨骼通道逐项比对，保持不变。

原因来自本地游戏包：pre_parallel2 输出 Tail～Tail6 旋转，molang 赋值生成三秒周期的 v.tail*y/z；parallel3 设置 L13 弹性参数 F=2、C=0.8、R=20；parallel4 以 0.01 秒步长更新弹性位置和速度。此前把身体动作独立烘焙并移除辅助条目后，这些运行时变量丢失。

参考 openysm-code/PlayerAnimationController.java 与 ParallelProcessor.java，OpenYSM 使用独立的 pre_parallel / parallel 控制器层。仓库：https://github.com/OpenYSM/OpenYSM 。本次将缺失尾巴层的稳态弹性响应烘焙到身体 Action，不重新加回用户要求删除的辅助条目；不声称复刻完整 Minecraft 实时物理环境。

普通源周期为三秒。短循环根据实际动作时长选取整数周期，确保摆尾首尾闭合；不改变 GUI 的总帧数。sleep 和 elytra_fly 使用较小振幅，保留原本的折尾姿态。无明确时长、原本仅 1 帧的循环站姿扩展为 3 秒以承载摆尾，而非保留静态占位片段。报告见 library-enhancement-report.json、library-verification.json。

## 检查证据

两份模型各 46 个动作，在多个采样帧检查 -1 自动及 0～6 手动表情、嘴巴控制、隐藏状态、面部骨骼和有限坐标：总计 2304 个兼容性场景。GUI 在 120、150、166、180、190、200、360、540 帧的全部骨骼矩阵一致；GUI 名称、30 fps、0～540 帧保持一致。

拉杆两个方向逐帧检查 0～20，维持原先的手掌、袖口和裙摆修正：角色与拉杆部件无表面交叉；前臂/头发/配饰检查无交叉；裙摆保持原始站姿，脚固定。原模型隐藏的衣服内部搭接与肩部接缝不属于零交叉声明。

QA 文件夹有两种配色的 GUI 表情、全部七种拉杆表情渲染。lever-preview.gif/mp4 与 snowfox-lever-preview.gif/mp4 为当前交替循环预览。GLB 验证报告分别为 winefox-validation.json、snowfox-validation.json。

## 重建

依次运行 create_lever_actions.py（基础拉杆）、audit_tail.py（原始尾巴审计）、enhance_library.py（尾巴补层、自动表情及雪狐副本）、verify_library.py、export_library.py。final_checks.py 进行拉杆逐帧验证；render_motion.py 渲染往返预览，环境变量 LEVER_VARIANT=snowfox 可渲染雪狐；render_face_qa.py 渲染表情证明。

close_tail_loops.py 是补做短循环闭合的修复脚本，当前 enhance_library.py 已整合相同逻辑，正常重建不必再运行它。

旧的单方向 .blend/.glb 和 v1/v2/.blend1 为历史输出。当前推荐两个主模型，不把方向拆成两份。来源和 CC BY-NC-SA 4.0 许可见 SOURCE.txt，保留原作者署名。

## 雪狐嘴型贴图修复

雪狐原 skin_white.png 在当前七种表情所用的部分嘴型 UV 上完全透明，导致骨骼与表情驱动正常但实际看不到嘴巴。fix_snow_mouth.py 为七个表情对象创建独立的 SnowFox_Face_Atlas，仅在这些面部 UV 使用的区域补回原酒狐贴图中可见、雪狐贴图中透明的 63 个像素；身体仍使用原 skin_white.png。专用贴图保存于 textures/snowfox-face-atlas.png，同时打包进 snowfox-large-lever.blend 与 GLB。

全部 46 个 Action 的关键帧曲线在修复前后校验一致；未改变动作名称、帧率与长度。enhance_library.py 已在重建末尾自动执行此修复。verify_snow_mouth_pixels.py 检查七种表情的实际 UV 像素透明度与贴图打包状态，结果见 snow-mouth-opacity-verification.json；修复报告见 snowfox-mouth-fix.json。另已重新通过全部动作兼容性检查、渲染默认嘴型与七种手动表情及 GUI 自动表情，并更新雪狐预览。雪狐 GLB 验证为零错误、零警告。
