# ARCFØX 启动动画

基于 GitHub Release 0.4.01，按用户提供的分镜及 ChatGPT 实现要求制作。
用户允许调整代码，但不得偏离要求。完整原要求见 [USER-REQUIREMENTS.md](startup-animation/USER-REQUIREMENTS.md)。
参考 GIF 的克制展开与聚合节奏；图标是重新绘制的几何狐形 SVG，字标是 ARCFØX，
没有复用 OpenAI Logo 或动画路径，也没有使用完整酒狐角色头像。

## 视觉与时间线

用户最新纠正：首次冷启动完整播放 **5500ms**，同一窗口刷新保留 **2600ms**。下表基础时间按比例映射到冷启动；六阶段顺序、重叠与最终静止不变。新时长要求覆盖原附件的总时长条款，其余要求继续适用。

| 阶段 | 刷新时间 | 冷启动时间（约） | 实现 |
|---|---|---|---|
| 01 Seed | 0–200ms | 0–423ms | 中心6个主要粒子，透明度与0.6→1尺寸渐变 |
| 02 Expansion | 200–800ms | 423–1692ms | 固定种子的柔和扩散场，轻微漂移 |
| 03 Logo Formation | 800–1400ms | 1692–2962ms | 四次缓出汇入SVG alpha采样目标，靠近目标后逐格补全实体图标 |
| 04 Logo Lift | 1400–1800ms | 2962–3808ms | 基础100ms停留，再三次缓出上移，1080p参考60px、缩至0.94 |
| 05 ARCFØX Formation | 1650–2150ms | 3490–4548ms | 从下方汇入字标掩膜，每字基础35ms交错；Ø斜线自左下至右上基础150ms完成 |
| 06 Final | 2150–2600ms | 4548–5500ms | 图标、字标完全静止，停止rAF；总时长结束且应用就绪后进入控制台 |

若后端尚未就绪，保持第6阶段，无呼吸、悬浮或第7阶段。服务状态仍显示，日志放在可展开的「启动详情」。
标题栏位于遮罩之外，真实窗口控制仍可使用。sessionStorage只区分本窗口是否已启动，不跳过动画；新窗口冷启动，重载仍完整播放六阶段。存储不可用时按Navigation Timing的reload类型判断。

亮暗共用唯一 ParticleSystem：seed 0xA7CF0A，同一ID、数量、轨迹、目标、延迟、尺寸、速度与时间。
主题只选颜色、透明度语义与微弱阴影；切换时不重建模拟。
亮背景#F7F9FC、暗背景#0B0F1A，暗粒子77%低亮、20%中亮、3%高亮。
桌面320粒子（图标200、文字120），移动212粒子（图标132、文字80）；不增加总粒子预算。
文字粒子参考1080p尺寸4–6px、平滑加减速，亮色使用清楚的中蓝；按目标距离补全笔画，不整行淡入。
SVG六字可见宽度各40、字进距54，五处可见间隙均14，Ø斜线落在本字范围内。
图标宽度为视口11% / 移动24%；最终字标可见宽度约图标圆角底板1.6倍，居中、与图标保持留白。
坐标经共同布局缩放与中心归一化，不依赖主题或字体安装。

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

运行开发服务器后打开 http://127.0.0.1:3400/startup-preview.html （冷启动5500ms）。
部署后也可打开 http://127.0.0.1:3210/startup-preview.html；添加 `?mode=reload` 预览刷新2600ms。

```powershell
node tools/run-all-checks.mjs --profile static
```

用户已停用38套，只保留原编号1、2、3、5、30，见 [REGRESSION-WORKFLOW.md](REGRESSION-WORKFLOW.md)。
启动历史21项与真实Electron历史验收脚本不再自动执行；原始报告、窗口证据、GIF保存在 startup-animation/，不代表新时长的验收。
本次使用单浏览器定点观察亮暗六阶段、字母掩膜间隙、最终静止及实际页面冷启动/刷新时长；证据见 [本次观察](startup-adjustment/inspection.json)。未恢复旧43套。
历史0.4.01 Release及标签保持可追溯。
