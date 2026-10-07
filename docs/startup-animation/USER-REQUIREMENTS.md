# ARCFØX / ARCFOX Startup Animation
# Light + Dark Theme Implementation Prompt

请实现 ARCFØX 应用启动动画。

这是一个克制、现代、科技感的启动动画。
视觉语言参考现代 AI 产品的生成式 Logo 动效，但不要直接复制任何现有品牌 Logo、动画路径或造型。

核心视觉：

蓝白点阵 → 聚合形成 Nekogram / 酒狐风格抽象图标
→ 图标完整形成
→ 图标向上移动
→ 下方粒子形成 ARCFØX
→ 最终静止

重点：
不要设计新的第 7 阶段。
最终状态必须保持第 6 阶段的 Logo 形象。

==================================================
0. 最重要的亮暗主题规则
==================================================

Light Mode 和 Dark Mode 不是两套动画。

它们必须共享完全相同的：

- particle seed
- particle count
- particle ID
- initial position
- target position
- velocity
- trajectory
- delay
- lifetime
- size
- animation timing
- logo geometry
- wordmark geometry
- easing
- camera / layout
- logo movement distance

换句话说：

对于任意 particle[i]：

light.particle[i].x(t) === dark.particle[i].x(t)
light.particle[i].y(t) === dark.particle[i].y(t)

亮色与暗色版本只能改变：

- background color
- particle color
- logo color
- wordmark color
- opacity compensation
- 极轻微 glow / shadow 参数

禁止为了暗色模式重新随机生成粒子。

如果程序使用随机数生成粒子：
必须使用固定 deterministic seed。

例如：

PARTICLE_SEED = 0xARCFOX

如果语言/框架不允许该格式，
转换成固定整数 seed。

切换 Light / Dark 时：
不得重新初始化 particle system。

==================================================
1. Overall Style
==================================================

关键词：

minimal
restrained
clean
generative
AI-inspired
soft technology
blue-white
geometric
calm
premium
eye-friendly

避免：

cyberpunk
gaming RGB
neon overload
lens flare
metallic 3D
glassmorphism overload
explosion
smoke
fire
high-frequency flashing
excessive bloom
complex anime illustration

整体应该让人感觉：

“这些点正在计算并生成品牌标志。”

而不是：

“一个 Logo 加了一层粒子特效。”

==================================================
2. Logo Design
==================================================

Logo 参考用户提供的 Nekogram Logo 构图，
同时吸收“酒狐”角色的视觉特征。

但最终必须重新抽象。

不要直接使用完整角色头像。

Logo 应该是：

- 几何化
- 简化
- 对称感较强
- 白色/蓝白主体
- 两个明显耳朵
- 耳朵内部有蓝色结构
- 简化的两个蓝色视觉点
- 少量几何切面
- 适合 32×32 / 64×64 小尺寸显示

Logo 的感觉：

cute but restrained
friendly but technological

不能过度萌化。
不能出现复杂五官。
不能出现完整人物身体。

==================================================
3. Wordmark
==================================================

最终文字：

ARCFØX

注意：

不是 Nekogram。
不是 ARCFOX。

正式品牌文字优先使用：

ARCFØX

Ø 是整个文字 Logo 的视觉重点。

字体方向：

geometric sans-serif
modern
clean
slightly futuristic
medium weight

避免：

电竞字体
过度倾斜
过度尖锐
机械战甲字体
复杂装饰字体

ARC 必须非常容易识别。

==================================================
4. Animation Timeline
==================================================

总时长：

约 2600 ms

允许范围：

2400–2800 ms

动画严格分为 6 个视觉阶段。

--------------------------------
STAGE 01
0–200 ms
Seed
--------------------------------

背景已经显示。

画面视觉中心附近出现少量蓝白粒子。

不是突然爆炸。

最初可以只有：

1–8 个主要粒子

随后出现更多微弱粒子。

粒子尺寸参考：

2–6 px @ 1920×1080

动画：
opacity 0 → 1
scale 0.6 → 1

运动非常轻微。

--------------------------------
STAGE 02
200–800 ms
Particle Expansion
--------------------------------

粒子逐渐扩散。

推荐：

150–300 particles

粒子不是随机飞散。

应该表现成一个正在形成的“计算场”。

运动可以包含：

- radial expansion
- slight vertical drift
- subtle turbulence
- attraction field

整体运动必须柔和。

此时只能隐约感觉到 Logo 的轮廓。

--------------------------------
STAGE 03
800–1400 ms
Logo Formation
--------------------------------

每颗粒子开始向 Logo Mask 的目标位置聚合。

每个 particle 具有：

startX
startY
targetX
targetY
delay
size
opacity

禁止：

Logo 直接 fade in。

正确方式：

粒子逐渐移动到 Logo 的目标采样点，
随着目标距离减小，
Logo 本体逐渐变得完整。

建议：

distance < threshold
→ particle opacity decreases
→ solid logo contribution increases

最终形成完整 Logo。

Easing：

easeOutQuart

或：

cubic-bezier(0.22, 1, 0.36, 1)

--------------------------------
STAGE 04
1400–1800 ms
Logo Lift
--------------------------------

Logo 完成后短暂停留：

80–120 ms

随后 Logo 向上移动。

Reference @ 1080p：

translateY:
0 → -60px

允许：

-50px ~ -80px

同时：

scale:
1.00 → 0.94

使用：

easeOutCubic

移动必须柔和。

不要弹跳。

不要 overshoot。

Logo 向上移动后，
下方自然产生 Wordmark 的空间。

--------------------------------
STAGE 05
1650–2150 ms
ARCFØX Formation
--------------------------------

注意：

这个阶段与 Logo Lift 有轻微时间重叠。

下方开始出现蓝白粒子。

粒子从较低位置向上运动，
逐渐锁定到文字 Mask。

形成：

A R C F Ø X

建议字符 stagger：

A = 0 ms
R = +35 ms
C = +70 ms
F = +105 ms
Ø = +140 ms
X = +175 ms

但是视觉上不能感觉像：

A 出现
停
R 出现
停

应该仍然感觉整行文字正在同时形成。

Ø：

先形成 O 主体。

随后一条斜线：

bottom-left → top-right

快速完成 Ø。

Duration：

120–160 ms

这是整个动画唯一允许稍明显的 Accent Motion。

--------------------------------
STAGE 06
2150–2600 ms
Final State
--------------------------------

残余自由粒子逐渐消失。

Logo 与 ARCFØX 完全稳定。

最终：

            [ LOGO ]

            ARCFØX

保持中心对齐。

Logo 与文字之间保持充足留白。

最终画面：

NO particle movement
NO breathing
NO pulsing
NO continuous glow animation
NO floating

完全静止。

随后进入应用主界面。

不要添加 Stage 07。

==================================================
5. LIGHT MODE
==================================================

Light Mode 应该：

clean
soft
cool
airy

背景不要纯 #FFFFFF。

推荐：

background:
#F7F9FC

或者：

#FAFCFF

主要粒子：

#FFFFFF
#E8F2FF
#DCEBFF
#BBD8FF
#8DBAFF

Accent：

#669EFF

Deep Accent：

#416FC5

Logo：

主体：
#F8FBFF / #FFFFFF

浅蓝区域：
#DCEBFF

中蓝：
#A9CCFF

耳朵内部：
#6F96DA

深蓝细节：
#416FC5

ARCFØX Wordmark：

推荐：

#416FC5

或更克制：

#3F5F96

Ø Slash：

#669EFF

Light Mode Shadow：

非常轻。

例如：

0 8px 30px rgba(65, 111, 197, 0.08)

不要明显蓝色光晕。

==================================================
6. DARK MODE
==================================================

Dark Mode 的目标不是：

“把亮色版本背景换成黑色。”

目标是：

“长时间观看更加护眼的冷暗环境。”

不要使用纯：

#000000

推荐背景：

#0B0F1A

备选：

#0D121F

或者：

#101521

可以有非常轻微的中心亮度差，
但不要明显 radial gradient。

主要粒子：

#203C73
#315DA8
#4F8CFF
#7FB0FF
#D8E8FF

核心粒子可以接近：

#EAF3FF

但数量必须少。

Dark Mode 中不要让所有粒子都发亮。

推荐：

70–80% 粒子低亮度
15–25% 中等亮度
< 5% 高亮度

避免视觉疲劳。

Logo：

主体：

#EAF3FF

浅蓝：

#C7DCFF

中蓝：

#7FAEFF

耳朵内部：

#416FC5

深色结构：

#1A2A44

ARCFØX：

#DCEBFF

Ø Slash：

#669EFF

Dark Mode Glow：

只能使用极轻微 Glow。

例如：

0 0 16px rgba(79, 140, 255, 0.15)

禁止：

大面积 neon bloom。

==================================================
7. Light / Dark Particle Synchronization
==================================================

这是硬性要求。

建立唯一 Particle Simulation。

例如：

const particles = generateParticles(SEED);

然后 Theme 只提供：

getParticleColor(particle, theme)

不要：

if (dark) generateParticles()
if (light) generateParticles()

正确：

particle.geometry = shared
particle.motion = shared
particle.theme = dynamic

因此同一时间：

Light Mode 第 412ms 的粒子位置

必须和

Dark Mode 第 412ms 的粒子位置

完全相同。

如果将两个动画叠加：

所有粒子的几何位置应该完全重合。

唯一差异：

颜色
亮度
透明度
Glow

==================================================
8. Particle → Logo Sampling
==================================================

不要手工写 Logo 坐标。

使用：

logo.svg

将 SVG Rasterize 到：

OffscreenCanvas

读取：

alpha mask

从 alpha > threshold 的区域进行采样。

例如：

alpha > 128

产生：

logoTargetPoints[]

同理：

wordmark.svg

产生：

wordmarkTargetPoints[]

然后：

particle.target = sampledPoint

这样最终 Logo 不会因为粒子系统而发生形变。

==================================================
9. Recommended Particle Object
==================================================

Particle 数据至少包含：

{
    id,
    seed,
    startX,
    startY,

    x,
    y,

    logoTargetX,
    logoTargetY,

    wordTargetX,
    wordTargetY,

    size,
    opacity,

    delay,
    lifetime,

    velocityX,
    velocityY,

    phase
}

Theme 不应该改变：

x
y
target
velocity
delay

==================================================
10. Responsive Layout
==================================================

Reference Canvas：

1920 × 1080

但必须响应式。

所有坐标使用 normalized coordinates。

例如：

x = viewportWidth * normalizedX
y = viewportHeight * normalizedY

Logo 最终宽度：

约 viewportWidth 的 8–12%

移动端可以：

16–24%

Wordmark：

宽度约为 Logo 的：

1.4–1.8×

Logo 和文字整体视觉中心：

略高于屏幕绝对中心。

==================================================
11. Performance
==================================================

目标：

60 FPS

最低：

稳定 30 FPS

推荐实现：

Web:
Canvas 2D
WebGL
Three.js Points

Flutter:
CustomPainter

Android:
Canvas / Compose Canvas

iOS:
Metal / SwiftUI Canvas

Desktop:
Skia / WebGL / Canvas

粒子数量不需要很多。

推荐：

Desktop:
200–350

Mobile:
120–220

不要为了“高级感”使用数千粒子。

动画的高级感来自：

motion quality

而不是：

particle quantity

==================================================
12. Accessibility
==================================================

支持：

prefers-reduced-motion

Reduced Motion 模式：

不执行完整粒子动画。

改为：

Logo opacity 0 → 1
Logo translateY 10px → 0

ARCFØX opacity 0 → 1

总时长：

400–600 ms

禁止闪烁。

任何单个元素不要产生高频亮度变化。

Dark Mode 尤其避免高亮白粒子大面积同时出现。

==================================================
13. Deliverables
==================================================

最终代码结构尽量拆分：

StartupAnimation
ParticleSystem
LogoFormation
WordmarkFormation
ThemeTokens
AnimationTimeline

资源：

arcfox-logo.svg
arcfox-wordmark.svg

主题：

lightTheme
darkTheme

动画几何：

sharedParticleGeometry

最终必须确保：

LIGHT 和 DARK 使用同一套动画数据。

==================================================
FINAL DESIGN PRINCIPLE
==================================================

不要把它理解成：

“Logo + 粒子特效”。

应该理解成：

“Logo 本身暂时以粒子的形式存在，
粒子经过计算逐渐找到自己的位置，
最终成为 ARCFØX。”

Light 和 Dark 是同一个世界的两种照明条件，
不是两套不同动画。