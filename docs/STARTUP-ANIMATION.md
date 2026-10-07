# ARCFØX 启动动画

基于 GitHub Release 0.4.01，按用户提供的分镜及 ChatGPT 实现要求制作。
用户允许调整代码，但不得偏离要求。完整原要求见 [USER-REQUIREMENTS.md](startup-animation/USER-REQUIREMENTS.md)。
参考 GIF 的克制展开与聚合节奏；图标是重新绘制的几何狐形 SVG，字标是 ARCFØX，
没有复用 OpenAI Logo 或动画路径，也没有使用完整酒狐角色头像。

## 视觉与时间线

用户最新纠正：首次冷启动完整播放 **2000ms**，同一窗口刷新 **1000ms**。2600ms基础模拟时间分别按比例映射到两种播放时长；六阶段顺序、重叠与最终静止不变。新时长要求覆盖此前4000ms、5500ms与原附件的总时长条款，其余要求继续适用。实际动画画布始终16:9，按可用区域等比居中，窗口其他比例时留同色边，不拉伸Logo。

| 阶段 | 刷新时间 | 冷启动时间（约） | 实现 |
|---|---|---|---|
| 01 Seed | 0–77ms | 0–154ms | 中心6个主要粒子，透明度与0.6→1尺寸渐变 |
| 02 Expansion | 77–308ms | 154–615ms | 固定种子的扩散场，蓄势后明显加速、减速 |
| 03 Logo Formation | 308–538ms | 615–1077ms | 非匀速汇入SVG alpha采样目标，靠近目标后逐格补全实体图标 |
| 04 Logo Lift | 538–692ms | 1077–1385ms | 基础100ms停留，再三次缓出上移，1080p参考60px、缩至0.94 |
| 05 ARCFØX Formation | 635–827ms | 1269–1654ms | 从下方加速汇入字标掩膜并减速锁定，每字基础35ms交错；Ø斜线自左下至右上基础150ms完成 |
| 06 Final | 827–1000ms | 1654–2000ms | 图标、字标完全静止，停止rAF；总时长结束且应用就绪后进入控制台 |

若后端尚未就绪，保持第6阶段，无呼吸、悬浮或第7阶段。服务状态仍显示，日志放在可展开的「启动详情」。
标题栏位于遮罩之外，真实窗口控制仍可使用。sessionStorage只区分本窗口是否已启动，不跳过动画；新窗口冷启动，重载仍完整播放六阶段。存储不可用时按Navigation Timing的reload类型判断。

亮暗共用唯一 ParticleSystem：seed 0xA7CF0A，同一ID、数量、轨迹、目标、延迟、尺寸、速度与时间。
主题只选颜色、透明度语义与微弱阴影；切换时不重建模拟。
亮背景#F7F9FC、暗背景#0B0F1A，暗粒子77%低亮、20%中亮、3%高亮。
桌面320粒子（图标200、文字120），移动212粒子（图标132、文字80）；不增加总粒子预算。
参考用户本机OpenAI视频的蓄势、快速展开与缓慢收束节奏；图标和文字共用连续速度曲线：u³ / (u³ + (0.72×(1-u))³)。端点速度为0，中途明显提速；不复制品牌路径。
文字粒子参考1080p尺寸4–6px，亮色使用清楚的中蓝；按目标距离补全笔画，不整行淡入。
SVG六字可见宽度各40、字进距54，五处可见间隙均14，Ø斜线落在本字范围内。
图标宽度为视口11% / 移动24%；最终字标可见宽度约图标圆角底板1.6倍，居中、与图标保持留白。
坐标经共同布局缩放与中心归一化，不依赖主题或字体安装。

按用户新提供的亮暗特写重绘耳朵、长额发、两侧发束、蓝眼及切面，暗色使用深蓝底板与细蓝边；几何掩膜仍共用。字标改为几何轮廓填充，保留五处14单位字距。

## 冷启动日志

下方显示最近4条实际检查进度，详细时间戳保留在启动详情。先“检索 QQ…”，按宿主状态报告结果，再“查看 OneBot 状态…”及实际连接/诊断结果。读取失败不伪造“已就绪”。刷新不额外查询Hook配置。

“试图自动注入 SnowLuma…”仅在检索到QQ、Hook自动注入已开启、存在启用且已生成SnowLuma配置的账号、SnowLuma运行中且OneBot未连接时出现；状态行说明由SnowLuma处理。前端只读配置和状态，不执行launch/inject，也不将提示视为注入成功。QQ或配置不存在时省略此行。

`tools/patch-host-qq-detection.mjs`将宿主已有QQ.exe进程查询结果暴露为qqPortable.detectedRunning/detectedCount，兼容原running字段；复用原30秒缓存，不增加进程查询。重装宿主后需重新执行该幂等补丁再重启。

## 文件与生命周期

- `app/ui/assets/startup/arcfox-logo.svg`：图标与采样掩膜。
- `app/ui/assets/startup/arcfox-wordmark.svg`：矢量字标；Ø斜线也从该SVG读取。
- `app/ui/shell/startup-animation.mjs`：Theme tokens、timeline、SVG离屏栅格采样、ParticleSystem与Canvas绘制。
- `app/ui/shell/05-startup.js`：实际启动控制器，连接应用ready与动画complete，二者满足后摘除并释放。
- `app/ui/styles/05-startup.css`：启动遮罩、状态与日志。
- `app/ui/startup-preview.html`：独立预览，可重播、切换亮暗或拖动进度。

Canvas 2D、原生模块，无新增第三方依赖。DPR最高1.5，高刷新率屏也仅约60次绘制/秒。
最终静止阶段、页面隐藏停止绘制；关闭释放canvas、离屏资产引用、rAF、计时器与监听。
模块/Canvas/资源失败使用静态SVG降级，资源加载有2.5秒兜底，不阻塞应用ready。
系统prefers-reduced-motion或应用动效关闭时，500ms淡入与10px位移，不执行粒子动画。
CSP沿用既有self/data图片权限，没有放宽脚本策略。

app/00-core只调整启动遮罩接口：hideLoading交给控制器；bootLoop不提前摘遮罩，init的finally统一结束启动。
原配置、OneBot、首次设置引导、导航落点及错误处理仍走现有流程。

## 验证与预览

运行开发服务器后打开 http://127.0.0.1:3400/startup-preview.html （冷启动2000ms）。
部署后也可打开 http://127.0.0.1:3210/startup-preview.html；添加 `?mode=reload` 预览刷新1000ms。

```powershell
node tools/run-all-checks.mjs --profile static
```

用户已停用38套，只保留原编号1、2、3、5、30，见 [REGRESSION-WORKFLOW.md](REGRESSION-WORKFLOW.md)。
启动历史21项与真实Electron历史验收脚本不再自动执行；原始报告、窗口证据、GIF保存在 startup-animation/，不代表新时长的验收。
此前5500ms观察保留在 [历史观察](startup-adjustment/inspection.json)。本次4000ms、16:9、速度变化、统一字距、亮暗共享几何和最终静止见 [本次观察](startup-v2/inspection.json)。冷启动日志分支使用只读响应fixture：无QQ、未开启自动注入、无账号配置不出现注入提示；条件满足时出现。fixture不代表本机实际注入成功。
预览视频 [4秒动画](startup-v2/arcfox-4s-light.mp4)为20FPS采样导出，运行时仍约60FPS。未恢复旧43套。
部署后真实HTTP页面验证冷启动4000ms、刷新2600ms、普通QQ检测摘要、横宽/竖屏画布16:9及无未捕获异常，见 [部署观察](startup-v2/deployed-inspection.json)。该浏览器观察不冒充真实Electron性能采样。
历史0.4.01 Release及标签保持可追溯。


2026-10-07后续优化：冷启动2000ms、刷新1000ms已替代上述历史4000/2600ms观察口径。基础模拟仍为2600，粒子数量、字标、速度曲线、六阶段及最终静止未改；若核心尚未就绪，仍停留在最终阶段等待，因此动画时长不等于双击到可用的总时间。
