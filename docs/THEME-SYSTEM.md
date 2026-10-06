# 主题系统（皮肤 × 亮度）

---

## 一、两个正交维度

```html
<html data-skin="default|minecraft"     ← 皮肤：决定"什么风格"
      data-theme="light|dark">          ← 亮度：决定"亮还是暗"
```

两者**各自独立**，组合出 4 种外观。`shell/01-skin.js` 管皮肤、`shell/00-theme.js` 管亮度。
新增任何样式规则前，先想清"它属于哪个维度"。

> ⚠️ **亮度只有两档**，UI 里没有"跟随系统"入口 —— 这是用户明确要求过的
> （详见 `HANDOFF-WILL.md` §2.1）。`cycleTheme()` 在 `light` ↔ `dark` 之间直接翻转。
> 旧的 `auto` 偏好会被映射成合法值，但不要再把它加回界面。

`data-skin` 变化时派发 `qqa-skin-change` 事件；皮肤相关的运行时（MC 图标、音效、背景）
都挂这个事件做同步。

---

## 二、令牌（CSS 变量）

### 定义位置：**两处，都要给**

| 位置 | 内容 |
|---|---|
| `styles/00-tokens.css` | 默认皮肤，亮/暗各一组（值走 `--s-*` 调色板） |
| `styles/32-theme.css` | MC 皮肤，亮/暗各一组（**同名覆盖** `--q-*`） |

⚠️ **新增 `--q-*` 令牌时两处都要给。** CSS 变量"未定义"是**空**，不是继承 ——
漏给会让对应属性直接失效或落到初始值，而这一般只在切到那个皮肤时才暴露。

### 常用令牌速查

| 类别 | 令牌 | 用途 |
|---|---|---|
| 底色 | `--q-bg-base` | 内容区/侧栏/顶栏的底色（**默认皮肤里三者同值**，见 §六） |
| | `--q-bg-1/2/3` | 卡片、抬升面、更深一档的面 |
| | `--q-bg-sidebar` | 侧栏（默认皮肤亮色即 `--q-bg-base`；暗色比 base 亮一档） |
| | `--q-bg-titlebar` | **顶栏专用**，缺省回落 `--q-bg-base`（见 §六） |
| | `--q-bg-nav-hover` / `--q-bg-nav-active` | 导航交互态 |
| 文字 | `--q-fg` / `--q-fg-2` / `--q-fg-3` / `--q-fg-4` | 主/次/弱/最弱 |
| 线条 | `--q-line-1` … `--q-line-4` | 由浅到深 |
| 强调 | `--q-accent` / `--q-accent-hi` / `--q-accent-soft` / `--q-accent-line` | 主色四态 |
| 状态 | `--q-ok` / `--q-warn` / `--q-danger` / `--q-notice-bg` | 语义色 |
| 圆角 | `--q-r-xs/sm/md/lg/xl/full` | MC 皮肤把它们**全设为 0**（像素风没有圆角） |
| 动效 | `--q-mo-fast` `0.1s` / `--q-mo-base` `0.2s` / `--q-mo-slow` `0.3s` / `--q-mo-slower` `0.42s` | 时长 |
| | `--q-ease` / `--q-ease-out` / `--q-ease-spring` | 缓动 |
| 字体 | `--q-font`（正文） / `--q-font-code` / `--q-font-tarkov` | MC 皮肤把 tarkov 指向 MC 字体 |
| 尺寸 | `--q-titlebar-h` `40px` / `--q-toolbar-h` `44px` / `--q-sidebar-w` `168px` / `--q-sidebar-w-rail` `60px` | |

---

## 三、MC 皮肤（`32-theme.css`）

### 3.1 调色板

**亮色**（2026-10-06 提亮过一档，原为 `#d8d8d8`/`#c6c6c6` 的深石板灰，用户反馈"灰蒙蒙"）：

| 令牌 | 值 | 说明 |
|---|---|---|
| `--q-bg-base` | `#ebebeb` | 底 |
| `--q-bg-1` | `#f6f6f6` | 卡片面 —— **比底更亮**，让卡片浮起来 |
| `--q-bg-2` / `--q-bg-3` | `#e2e2e2` / `#d2d2d2` | |
| `--q-line-1` / `--q-line-2` | `#c2c2c2` / `#9e9e9e` | |
| `--q-fg` | `#1f1f1f` | 提亮底后同步加深，保住对比度 |
| `--q-accent` | `#2f7d32` | 草绿 |

**暗色**：`#1a1a1c` 底 / `#26262a` 卡片面 / `#5bbd5f` 强调（洞穴 + 火把金）。

MC 另有一组 `--q-mc-*` **素材色**（不参与皮肤切换逻辑，就是像素画的配色常量）：
`--q-mc-stone #c6c6c6`、`--q-mc-stone-dark #8f8f8f`、`--q-mc-wood #9c7a4a`、
`--q-mc-wood-dark #6b5432`、`--q-mc-grass #6aa84f`、`--q-mc-dirt #8b6b45`、
`--q-mc-panel #c6c6c6`、`--q-mc-slot #1e1e1f`、`--q-mc-gold #fcd34d` 等。

### 3.2 字体：**双字体链 + `unicode-range`**（顺序承重）

```css
@font-face { font-family:'Minecraft AE';     src:url('/assets/mc/fonts/minecraft-latin.ttf'); font-weight:100 900; }
@font-face { font-family:'Minecraft AE CJK'; src:url('/assets/mc/fonts/minecraft-ae.ttf');
             font-weight:100 900;
             unicode-range: U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF; }   /* ← 只吃汉字 */
```

**为什么必须这样分**：CJK 那份字体（15.8 MB）的**标点字形普遍是坏的** ——
半角 `:` 画成 `u`、`(` 画成 `C`、`/` 画成 `i`；全角 `）`/`％`/`＃` 也变形；`¥` 是个折线块。
而它唯一不可替代的是**汉字**。所以：

- 拉丁那份（14 KB）管 ASCII、货币、数学符号、**全角标点**；
- CJK 那份用 `unicode-range` **严格限定**只吃汉字区间。

⚠️ **顺序是承重的，别调换**；改完必须跑 `node tools/check-font-chain.mjs`（逐字形比对 19 个字符）。
字号/字距也调过：MC 皮肤正文 15px + `letter-spacing: 0.3px`（密集数字区 0.4px），
暗色正文 `#d0d0d0`。像素字体只有一个字重，`font-weight` 对它无效。

### 3.3 音效

素材在 `assets/mc/sfx/`（**10 个文件，全部由用户提供**）：

```
menu.wav(= 用户的 Click.wav)  pop.wav  bow.wav
hit1.wav hit2.wav hit3.wav
pistonin.wav pistonout.wav
beaconactivate.wav beacondeactivate.wav
```

映射表（`shell/02-mc-theme.js`）：

| 键 | 文件 | 说明 |
|---|---|---|
| `menu` | `menu.wav` | 菜单按钮音。**点击与开关的默认项都指向它**（用户指定） |
| `piston` | `pistonout.wav` / `pistonin.wav` | 开关用途，**分方向**（开=推出 / 关=收回） |
| `beacon` | `beaconactivate.wav` / `beacondeactivate.wav` | 开关用途，分方向 |
| `hit` | `hit1..3.wav` | 三种随机 |
| `bow` / `pop` | 各一个 | |

三个用途的候选列表：

```js
click:  ['menu', 'pop', 'hit', 'bow']                    // 默认 menu
toggle: ['menu', 'piston', 'beacon']                     // 默认 menu
slider: ['off', 'menu', 'pop', 'hit', 'bow', 'piston']   // 默认 off（不播放）
```

⚠️ **除故意共用的 `menu` 外，用途候选不许重叠** —— 对应需求"用于开关的不用于按钮和点击"。
默认偏好与迁移映射见 `02-mc-theme.js` 的 `DEFAULTS` / `SFX_RETIRED`
（`note/lever/wood/stone/pistonSynth → menu`，否则老配置会读出**空下拉框**）。

**已退役并删除的音效**（用户要求"原有的音效删除不打包"）：音符盒、拉杆、木质、石质按钮、合成活塞。
不要把它们加回来。

### 3.4 背景图

`assets/mc/bg/`，5 张（各带一张 `.thumb.png`）：

```
plains-dawn.png  forest-lake.png  mesa-canyon.png  cave-torch.png  night-stars.png
```

- 默认开启（`bgOn: true`），默认取第 0 张，**透明度默认 0.35**
  （需求"透明度默认要保持各种信息均可保持较好的鉴别程度"；上限锁 0.6）。
- 背景能被看见的关键是**把各个"面"变半透明**：`--mc-surface-alpha: 0.62`，
  用 `color-mix(... transparent)` 施加到 `#q-shell / .q-main / .q-body / .q-sidebar /
  .q-tb-status / #topbar.q-titlebar / .view` 以及卡片类上。
  > 这段是**功能性的，不是装饰**。删掉它背景图就被不透明的面盖住了。
- 生成脚本 `tools/gen-mc-bg.mjs`（已生成过，一般不用重跑）。

### 3.5 像素图标

`shell/03-mc-icons.js`：16×16 像素网格定义 + `toSvg(rects, size, cls)`，
换图标时把原 `outerHTML` 存进 `dataset.orig` 以便还原。
导航按钮用 `data-icon` 指定图标名（`gauge / chat / archive / brain / chart / spark / plugin / users / gear`）。

⚠️ 图标按**函数名**而非导航名索引（HTML 用的是函数名）。另外替换 `outerHTML` 时
class 会丢，所以 `toSvg` 必须把 class 一起输出 —— 这两点都踩过。

### 3.6 拉杆开关（`.switch` → 拉杆）

**这是最容易做错的一处**，两个要点：

1. **为什么原来不是拉杆**：MC 的拉杆是画在 `input[type=checkbox]` **自身**上的
   （`::before` 石座 + `::after` 木杆）。而设置页那批开关用的是 `.switch` 组件，
   它把复选框**视觉隐藏**了（`opacity:0; width:0`），显示的是 `.track` + `.thumb` ——
   所以拉杆根本画不出来，落回"胶囊 + 圆点"，和旁边的真拉杆放在一起极度违和。
2. **修法**：把 `.track` 当石座、`.thumb` 当木杆，在 MC 皮肤下重做外观：

```css
html[data-skin='minecraft'] .switch .track { width:30px; height:18px; border-radius:0;
  background:#8f8f8f; box-shadow: inset 2px 2px 0 rgba(255,255,255,.35), inset -2px -2px 0 rgba(0,0,0,.3); }
html[data-skin='minecraft'] .switch .thumb { top:1px; left:1px; width:8px; height:16px; border-radius:0;
  background: linear-gradient(#b08c58, #8b6b45 45%, #6b5432); }
/* 开态：石座透红石光，木杆推到右端 */
html[data-skin='minecraft'] .switch input:checked ~ .track .thumb { transform: translateX(20px); }
```

- ⚠️ **只平移不旋转**。像真拉杆那样绕底端转 38° 会把握把甩出 22px 高的轨道，
  在卡头那种紧凑行里会**盖住旁边的文字**。
- ⚠️ 选择器**必须**带 `html[data-skin=…]` 前缀：`40-market.css` 里的 `.switch .track`
  特指度 (0,2,0)，裸写同名规则压不过它。
- 原生 `input[type=checkbox]`（二级设置里那些）仍走 `32-theme.css` 里
  `::before/::after` 那套真拉杆，两者视觉语言保持一致。

---

## 四、个性化与动效（独立于皮肤）

| 模块 | 作用 |
|---|---|
| `shell/10-personalize.js` | 配色覆盖（60 个 `input[type=color]`，就是"个性化"页那些色块） |
| `shell/11-motion.js` | 动效总开关 → `html[data-motion='off']` |
| `styles/01-motion.css` | 动效时长/缓动令牌 |

`html[data-motion='off']` 与 `prefers-reduced-motion` 都要被尊重：
所有自绘动效（如主题扩散、卡片闪现）都要在这两个条件下退化为瞬时切换。

---

## 五、主题卡页

`app/14-theme-section.js` 是"主题"卡页：皮肤卡 + 亮度两档 + **MC 二级设置**。
MC 二级设置分三组（按 `.pz-group-title` 判断分组是否存在，**不要用整卡文本匹配** ——
卡头副标题会写"音效 · 背景 · 字体"，会造成误判）：

| 分组 | 内容 |
|---|---|
| 互动音效 | 总开关、音量、点击/开关/滑条三类音效的下拉选择 |
| 背景图 | 总开关、透明度滑条、5 张缩略图选择 |
| （字体） | **没有独立开关** —— 字体跟随皮肤自动生效（皮肤就决定字体），多一个开关只会让人不确定 |

> 该文件顶部注释标了警告：**模板字符串里的注释不能出现反引号**（会提前结束模板，
> `node --check` 报 `missing ) after argument list`）。

---

## 六、顶栏配色：一个被两版需求拉过的地方

| 时间 | 要求 | 做法 |
|---|---|---|
| 2026-10-04 | "不是每一个导航栏的颜色都是连续的" → 要**无痕** | 标题栏/功能条/侧栏/内容区统一到 `--q-bg-base`，横向接缝靠同色消除 |
| 2026-10-06 | "任务栏的底色应该和导航栏的颜色一致" | 新增 `--q-bg-titlebar`，MC 皮肤指向 `--q-bg-sidebar` |

**两个要求都对，冲突来自"哪个算导航栏"**。所以现在把这件事做成**令牌可调**：

```css
/* 02-titlebar.css */
background: var(--q-bg-titlebar, var(--q-bg-base));
```

要再调**只改 `32-theme.css` 里那一行**，不要去动 `02-titlebar.css` 的背景声明。

⚠️ 注意暗色下 `--q-bg-sidebar`(`#1b1b1c`) 与 `--q-bg-base`(`#151517`) 差 **6 级明度**，
一旦混用会出现**横贯整窗的色差线**。`tools/check-seamless-pixels.mjs` 就是守这个的
（它会像素级采样 y≈92 那一行）。
