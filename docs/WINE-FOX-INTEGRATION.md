# Wine_Fox 迁入、接入与性能评估

日期：2026-10-07。用户最新方向：后续酒狐进入 QQ Agent 主题，作为互动宠物。

最新2026-10-07三阶段迭代：仅MC自动显示、双角色GUI全身展示、循环/单次播放、连续点击生气、闲置60–120秒情绪、拖动语音保持及run回原位。见 [WINE-FOX-INTERACTION.md](WINE-FOX-INTERACTION.md)，以下初版为历史记录。

## 0.4.01移植实现（历史）

用户随后要求“尝试移植”，已将最新 GLB 与最小 Three.js 依赖接入主题设置。
默认关闭；开启后局部透明画布显示；默认 / MC 两套皮肤均可用。
提供开启、暂停、大小、位置复位、全部46动作及自动 / 手动表情；位置与偏好本地保存。
鼠标 / 触屏拖动只移动；2秒内3次轻点生气，6秒不点击恢复，暂停身体不暂停情绪计时。
高频悬停不做蒙皮射线；只在按下且二维范围内精确判断，透明区域主界面仍可点击。
暂停和隐藏停止绘制；关闭释放 DOM、监听、GPU 与 mixer；快速取消异步加载不会迟到创建宠物。

04-wine-fox.js 管轻量偏好与按需导入；wine-fox-runtime.mjs 管渲染、动画、输入和释放。
GLTFLoader 的内嵌图片采用 TextureLoader 插件，遵守既有 img-src blob，避免 ImageBitmapLoader
fetch blob 触发 connect-src；页面和宿主 CSP 未放宽。最小资源由 prepare-wine-fox.mjs 生成，GLB字节不变。
部署预检中发现旧 style.css 已删除但仍被列为必需，已修正为现有 legacy layer 文件契约。

最终部署页29/29检查通过（含触屏和弹窗输入）；完整42/42回归套件通过。
真实 Electron 首轮8/8通过，包含最小化 / 恢复、暂停、实际桥与运行错误检查。
RTX 4060 真机3秒短时采样：关闭约1.9 ms/秒主线程任务，开启约30.2 ms/秒、30 FPS；
暂停0 FPS，最小化0 FPS，恢复约30 FPS。开启时 JS堆约21.4 MiB，GC后约8.5 MiB；
不是进程RSS、GPU占用或整机CPU%。首轮真实报告和截图位于 shots/final/wine-fox-electron.*。
当前归档版本为0.4.01；验收报告与真实窗口截图保存在 docs/wine-fox-release/。完整功能回归与最终版本状态见 CHANGELOG。

下文为资源准备阶段的原评估。涉及“尚未接入”的描述是当时状态。

## 资源迁入

来源 `E:\CodeX-YSM\Finish-end`，目标
`E:\CodeX-YSM\QQ Agent Dev\qq-agent-ui-next\Wine_Fox`。
全部 1,320 文件、111,380,171 字节（106.22 MiB）迁入，逐文件 SHA-256 与来源相同。
MANIFEST 的 1,319 项全部通过；MANIFEST 本身为第 1,320 个文件。
README、交接、Blender、GLB、纹理、参考代码、预览、验证与来源许可全部保留。
Reference 脚本保留历史路径上下文，不能未经适配当作当前目录的一键构建系统。

Wine_Fox 位于项目根而非 app/ui，因此不会把整个参考包镜像进安装目录。
QQ Agent 主界面当前仍不加载新宠物；旧删除守卫继续保护旧运行时。

## 可行性

**可行性高；模型与交互可复用，集成必须改渲染调度、输入和资源生命周期。**
宿主是 Electron，默认开启硬件加速；新成品使用 GPU WebGL2 + 本地 Three.js，
不再使用旧 CPU 同步逐面光栅化。主题内宠物直接叠加在应用窗口内容区，
无需原生透明桌面窗口；若未来要求走出 QQ Agent 窗口，再设计独立窗口与鼠标穿透。

复用最新酒狐 GLB 的 46 个完整动作、203 根骨骼、七套表情、拖动与情绪计时。
保留 GUI 18 秒、死亡 / 失败自动呆住、拉杆双向交替、拖动只移动不旋转。
动画菜单从模型读取，不裁剪动作、不重新生成旧资产、不编造角色人设。
主题设置保存启用状态、大小和位置；显式开启后按需加载。

## 测量方法

运行 `node tools/profile-wine-fox.mjs`；来源校验可加
`"--source=E:\CodeX-YSM\Finish-end"`。
输出 docs/wine-fox-assessment 下的 assessment.json 与 pet-preview.png。
工具在临时本地 HTTP 响应中附加探针，原始 Wine_Fox 文件不修改。

本机 i7-12650H、RTX 4060 Laptop；独立无头 Edge，WebGL 实际使用 NVIDIA D3D11。
每场景预热 1 秒、采样 5 秒。没有在 QQ Agent Electron 内做整合后的对照测试。

| 项目 | 结果 |
|---|---:|
| 酒狐 / 雪狐 GLB | 6.55 / 6.57 MiB |
| 每个角色 | 203 joints、46 clips、每 clip 616 channels |
| 模型全部几何 | 19 primitives、5,444 triangles |
| 当前待机实际绘制 | 8 draw calls、5,088 triangles |
| 去重动画 accessor 数据 | 1.93 MiB，非完整运行时内存 |
| 参考页实际加载子资源 | 约 8.75 MiB |
| loaded 就绪时点 | 自导航约 517 ms，本机文件 / 缓存条件下 |
| 精确模型命中，30 次均命中 | 平均 9.53 ms，P95 12.4 ms |

| 场景 | 实际绘制 FPS | 主线程任务 ms/秒 | JS 堆快照 MiB |
|---|---:|---:|---:|
| 全窗口 1400×900 DPR1 | 240.2 | 173.2 | 27.4 |
| 全窗口 1400×900 DPR2 | 240.2 | 154.2 | 25.2 |
| 360×480 小绘图缓冲 DPR1 | 240.4 | 143.3 | 24.2 |
| 小绘图缓冲，动作暂停 | 240.4 | 156.9 | 15.5 |
| 小绘图缓冲，实验性 30 FPS 上限 | 27.8 | 43.6 | 7.6 |

任务时间来自 CDP Performance TaskDuration 差值，不是整机 CPU%。
173 ms/秒近似一个逻辑核 17.3% 的时间。JS render 提交约 0.25～0.31 ms，
GPU 异步执行，不能将提交时间当 GPU 帧时间。JS 堆受垃圾回收影响，不代表增量 RSS 或显存。
本次未测 QQ Agent 内的开关对照、系统 GPU%、功耗、显存和完整功能回归。

实验性限帧只处理身体、面部和渲染，未复刻原循环全部气泡 / 情绪过期逻辑，不能直接发布。
它比原全窗口场景的主线程任务时间低约 75%；该比例不能套用到整机耗电或宿主总负载。

## 性能损耗及适配

1. **高频悬停射线是主要输入风险。** pointermove 每次更新骨架、清空蒙皮包围球、检测三角面，
   约 10 ms 的调用叠加鼠标高频事件会挤占聊天与设置 UI。
   二维范围先粗筛；悬停粗判或限频；按下时才精确射线；拖动只解拖动平面。
2. **默认限制 30 FPS。** 目前循环跟随高刷屏约 240 FPS，交互时可临时提高至 60。
   源动画 30 fps 烘焙不会自动限制屏幕绘制帧率。
3. **使用角色附近的小画布。** 1400×900 DPR2 实际为 2800×1800，像素数是 360×480 DPR1 的约 29 倍。
   小画布主要减少 GPU 缓冲、填充和合成成本；DOM 负责定位与气泡，空白区域不得遮挡主界面。
4. **暂停 / 隐藏要停止绘制。** 当前暂停只将 mixer.timeScale 归零，仍提交场景。
   隐藏、最小化、关闭宠物时停止循环；完全静止时按需重绘。情绪仍按单调时钟计算。
5. **首次解析和 shader 编译有短时开销。** 按需加载一个酒狐，不同时加载雪狐，不为每个动作复制场景。
   保留完整动画，使用缓存、压缩与关键帧表达优化，而不是裁剪用户数据。
6. **关闭时显式释放。** 移除监听、停止循环、停止 / uncache mixer，对独占的 geometry、material、
   texture、skeleton、renderer 释放资源，避免反复开关后累积显存。
7. **硬件 WebGL 不可用时降级。** 宿主 QQ_AGENT_DISABLE_GPU=1 可进入软件模式；宠物应静态降级或提示可恢复错误，
   主界面继续工作，不回到旧 CPU 光栅化方案。

画布像素比与循环机制见 [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)、
[响应式尺寸说明](https://threejs.org/manual/pages/responsive.html)；
显式清理见 [资源释放说明](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)。

## 后续接入与验收

- 只把所需酒狐 GLB、Three.js 模块与许可放入 app/ui/assets，完整 Wine_Fox 保持独立。
- 新建宠物模块，暴露 setAnimation、setExpression、setPaused、setVisible、dispose，接到主题开关。
- 适配参考页全局 DOM id、resize、pointer 和画布输入范围，避免与宿主冲突。
- GLTFLoader 使用裸名 three；选择相对模块路径或合法 import map。
  新增内联 import map 时执行 csp-hash --write，同步页面、宿主和开发服务器 CSP。
- 每帧顺序保持 mixer → 自动面部采样 → 交互覆盖 → 世界矩阵 → 命中 / 渲染。
- 接入时把旧删除守卫改为宠物启停验收，保留关闭时无残留与原主题功能正常的保护。
- 在真实 Electron 内测首次加载、CPU、RSS、显存、鼠标事件 P95、最小化、主题切换和反复启停，
  再跑全量功能回归，确认既有功能不被遮挡或拖慢。

Models 的 SOURCE.txt 与 Three.js vendor 许可原样保留；模型 CC BY-NC-SA 4.0。
以后公开仓库保留作者与对应资源许可，不把第三方模型并入项目代码的宽松许可声明。
本次仅为资源与评估准备，VERSION 保持 0.4.0；功能接入并验收后再定下一版本和标签。
