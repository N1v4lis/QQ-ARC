// ═══════════════════════════════════════════════════════════════════════════
// gen-mc-bg.mjs — 生成 Minecraft 风格背景图（PNG，1920×1080）
// ═══════════════════════════════════════════════════════════════════════════
// 设计思路（这是"高清截图"在无法下载素材时的可行等价物）：
//
//   1. **先在极小分辨率上作画，再整数倍最近邻放大。**
//      MC 的世界本身就是方块构成的。用 384×216 作画（相当于 384 个"方块列"），
//      再 5 倍最近邻放大到 1920×1080 —— 每个逻辑像素变成一个 5×5 的硬边色块，
//      这正是 MC 截图缩放后的观感。如果直接在 1920×1080 上画平滑图形，
//      反而会得到一张"普通插画"，不像 MC。
//
//   2. **色板取自 MC 的实际方块颜色。** 见 PALETTE，草/泥土/石头/水/沙/雪
//      都按游戏里那几档明度取值，并做少量随机抖动（MC 的方块表面本来就有噪点）。
//
//   3. **五张场景各自不同**，覆盖"能当壁纸看"的几种氛围：
//      平原日出 / 夜晚星空 / 洞穴火把 / 森林湖泊 / 峡谷（台地）。
//      用户的诉求是"默认要有 3-5 张"，这里给满 5 张。
//
//   4. 输出 PNG。为什么自己写 PNG 编码器：这个环境里没有安装图片库，
//      而 PNG 的最小实现只需要 zlib（Node 内置）+ CRC32（自己写 20 行）。
//      JPEG 才是"截图"常见格式，但需要 DCT 量化，代码量是 PNG 的十几倍且
//      有损 —— 像素画恰恰最怕有损压缩（会出现彩色噪点，破坏硬边）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = process.argv[2] || 'app/ui/assets/mc/bg';
const SCALE = 5;              // 放大倍数（384*5=1920, 216*5=1080）
const W = 384;
const H = 216;

// ── PNG 编码 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
/** rgb: Uint8Array，长度 w*h*3，已按 SCALE 放大 */
function encodePng(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;                      // filter: none
    rgb.copy
      ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 绘画工具 ────────────────────────────────────────────────────────────────

/** 384×216 的 RGB 画布 */
function canvas() {
  return { w: W, h: H, px: new Uint8Array(W * H * 3) };
}
function put(c, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  c.px[i] = r; c.px[i + 1] = g; c.px[i + 2] = b;
}
function get(c, x, y) {
  const i = (y * c.w + x) * 3;
  return [c.px[i], c.px[i + 1], c.px[i + 2]];
}
function rect(c, x0, y0, x1, y1, col) {
  for (let y = Math.max(0, y0); y <= Math.min(c.h - 1, y1); y += 1)
    for (let x = Math.max(0, x0); x <= Math.min(c.w - 1, x1); x += 1) put(c, x, y, col);
}
/** 整数倍最近邻放大；顺带做一次轻微的方块噪点，贴近 MC 方块表面的质感 */
function upscale(c, withNoise = true) {
  const w = c.w * SCALE;
  const h = c.h * SCALE;
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const sy = (y / SCALE) | 0;
    for (let x = 0; x < w; x += 1) {
      const sx = (x / SCALE) | 0;
      let [r, g, b] = get(c, sx, sy);
      if (withNoise) {
        // 以"逻辑像素"为单位抖动（同一个方块内颜色一致），幅度 ±3
        let n = ((sx * 73856093) ^ (sy * 19349663)) & 0xFF;
        n = (n % 7) - 3;
        r = Math.max(0, Math.min(255, r + n));
        g = Math.max(0, Math.min(255, g + n));
        b = Math.max(0, Math.min(255, b + n));
      }
      const i = (y * w + x) * 3;
      out[i] = r; out[i + 1] = g; out[i + 2] = b;
    }
  }
  return { data: out, w, h };
}

// ── 色板（取自 MC 方块的实际颜色区间） ──────────────────────────────────────
const P = {
  grassTop: [124, 176, 74],
  grassSide: [104, 148, 62],
  dirt: [134, 96, 67],
  dirtDark: [110, 78, 54],
  stone: [128, 128, 128],
  stoneDark: [104, 104, 104],
  stoneLight: [150, 150, 150],
  deepslate: [80, 80, 84],
  water: [58, 110, 190],
  waterDeep: [40, 78, 148],
  sand: [219, 207, 163],
  sandDark: [196, 182, 138],
  woodOak: [110, 82, 48],
  woodDark: [86, 64, 38],
  leaf: [58, 112, 44],
  leafDark: [44, 88, 34],
  leafLight: [78, 138, 56],
  snow: [240, 244, 248],
  snowShade: [214, 222, 232],
  torch: [252, 210, 90],
  lava: [208, 96, 30],
  mesa: [168, 92, 52],
  mesaDark: [138, 72, 40],
  skyDay: [120, 168, 232],
  skySunset: [246, 160, 92],
  skyNight: [12, 16, 40],
  cloud: [238, 240, 245],
  cloudShade: [206, 212, 222],
  moon: [232, 236, 244]
};

/** 把 [r,g,b] 乘一个系数（明度调整），用于做光照明暗 */
function shade([r, g, b], k) {
  return [Math.max(0, Math.min(255, r * k)) | 0, Math.max(0, Math.min(255, g * k)) | 0, Math.max(0, Math.min(255, b * k)) | 0];
}
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * 天空垂直渐变。
 * @param warmFrom 从这个高度比例（0~1）开始混入下方的暖色（日出/黄昏的地平线光）。
 *   为什么需要这个参数：整屏从头到尾插值会让中间出现一大片"蓝不蓝橙不橙"的灰带
 *   （实测第一版平原图就是上半屏幕发灰）。真实日出的暖光只集中在**地平线附近**，
 *   上面应当仍是干净的蓝。所以分两段：0~warmFrom 纯蓝渐变，之后才混暖色。
 */
function skyGradient(c, skyTop, skyBottom, warmFrom = 0) {
  for (let y = 0; y < c.h; y += 1) {
    const t = y / (c.h - 1);
    let col;
    if (t <= warmFrom) {
      const u = warmFrom > 0 ? t / warmFrom : 1;
      col = [
        (skyTop[0] + (skyBottom[0] - skyTop[0]) * u * 0.22) | 0,
        (skyTop[1] + (skyBottom[1] - skyTop[1]) * u * 0.22) | 0,
        (skyTop[2] + (skyBottom[2] - skyTop[2]) * u * 0.22) | 0
      ];
    } else {
      const u = (t - warmFrom) / Math.max(0.001, 1 - warmFrom);
      const base = [
        skyTop[0] + (skyBottom[0] - skyTop[0]) * 0.22,
        skyTop[1] + (skyBottom[1] - skyTop[1]) * 0.22,
        skyTop[2] + (skyBottom[2] - skyTop[2]) * 0.22
      ];
      col = [
        (base[0] + (skyBottom[0] - base[0]) * u) | 0,
        (base[1] + (skyBottom[1] - base[1]) * u) | 0,
        (base[2] + (skyBottom[2] - base[2]) * u) | 0
      ];
    }
    rect(c, 0, y, c.w - 1, y, col);
  }
}

/** MC 风格的方块云：一排排硬边矩形，底部带一条阴影 */
function clouds(c, y0, count, seed, col = P.cloud, shadeCol = P.cloudShade) {
  const rng = makeRng(seed);
  let x = -30;
  for (let i = 0; i < count; i += 1) {
    const w = 26 + ((rng() * 46) | 0);
    const h = 5 + ((rng() * 5) | 0);
    const y = y0 + ((rng() * 16) | 0) - 8;
    rect(c, x, y, x + w, y + h, col);
    rect(c, x, y + h, x + w, y + h + 1, shadeCol);   // 底面阴影，做出体积
    x += w + 12 + ((rng() * 34) | 0);
  }
}

/** 一条起伏的地形轮廓（返回每列的地表高度） */
function heightmap(c, base, amp, seed, rough = 1) {
  const rng = makeRng(seed);
  const hs = new Array(c.w);
  let h = base;
  for (let x = 0; x < c.w; x += 1) {
    // 随机游走 + 回归基准，得到"有起伏但不跑偏"的地形
    h += (rng() - 0.5) * amp * rough;
    h += (base - h) * 0.02;
    hs[x] = Math.round(h);
  }
  return hs;
}

/** 按高度图填土（草皮 1~2 层 + 泥土到底） */
function fillGround(c, hs, groundY, { top = P.grassTop, topSide = P.grassSide, body = P.dirt, body2 = P.dirtDark } = {}) {
  const rng = makeRng(9001);
  for (let x = 0; x < c.w; x += 1) {
    const y = hs[x];
    put(c, x, y, rng() < 0.5 ? top : shade(top, 0.94));
    put(c, x, y + 1, topSide);
    for (let yy = y + 2; yy <= groundY + 40; yy += 1) {
      const d = rng() < 0.22;
      put(c, x, yy, d ? body2 : body);
    }
  }
}

/**
 * 前景地面：比 fillGround 多一条**顶面亮边**。
 *
 * 为什么需要单独一个：MC 里草方块从侧面看就是"顶面一条亮草 + 下面泥土"，
 * 那条亮草是整个画面的"地平线"标识。没有它，远山与前景会糊成一片绿
 * （第一版就是这个问题：远山和前景都是绿的，看不出层次）。
 * @param horizon 地平线基准 y（地表在它上下抖动）
 * @param depth   地表最大起伏
 */
function foregroundGround(c, horizon, depth, seed, { top = P.grassTop, side = P.grassSide, body = P.dirt, body2 = P.dirtDark } = {}) {
  const rng = makeRng(seed);
  const hs = new Array(c.w);
  let h = horizon;
  for (let x = 0; x < c.w; x += 1) {
    h += (rng() - 0.5) * 1.1;
    h += (horizon - h) * 0.04;
    hs[x] = Math.round(h);
  }
  for (let x = 0; x < c.w; x += 1) {
    const y = Math.max(horizon - depth, Math.min(horizon + depth, hs[x]));
    put(c, x, y, rng() < 0.5 ? top : shade(top, 0.93));
    put(c, x, y + 1, side);
    for (let yy = y + 2; yy < c.h; yy += 1) {
      const r = rng();
      put(c, x, yy, r < 0.24 ? body2 : body);
    }
  }
  return hs;
}

/** 一棵 MC 风格的树（树干 + 一坨方形树冠） */
function tree(c, x, groundY, height, seed) {
  const rng = makeRng(seed);
  for (let y = groundY - height; y <= groundY; y += 1) {
    put(c, x, y, rng() < 0.3 ? P.woodDark : P.woodOak);
    put(c, x + 1, y, rng() < 0.3 ? shade(P.woodDark, 0.9) : shade(P.woodOak, 0.9));
  }
  const top = groundY - height;
  const cw = 4;
  for (let yy = top - cw; yy <= top + 1; yy += 1) {
    const half = cw - Math.max(0, Math.abs(yy - (top - 1)) - 1);
    for (let xx = x - half; xx <= x + 1 + half; xx += 1) {
      if (xx < 0 || xx >= c.w) continue;
      const r = rng();
      put(c, xx, yy, r < 0.18 ? P.leafDark : (r < 0.32 ? P.leafLight : P.leaf));
    }
  }
}

/** 水：横向条纹 + 亮线，MC 的水面就是这种硬边波纹 */
function water(c, y0, y1, seed) {
  const rng = makeRng(seed);
  for (let y = y0; y <= y1; y += 1) {
    const deep = (y - y0) / Math.max(1, y1 - y0);
    const base = y < y0 + 2 ? P.water : shade(P.waterDeep, 1 - deep * 0.25);
    for (let x = 0; x < c.w; x += 1) {
      const wave = ((Math.sin((x + y * 3) * 0.22) + 1) / 2) > 0.72;
      put(c, x, y, wave ? shade(base, 1.18) : (rng() < 0.08 ? shade(base, 1.08) : base));
    }
  }
}

// ── 五个场景 ────────────────────────────────────────────────────────────────

/** 1. 平原日出 —— 最"标准"的 MC 第一眼 */
function scenePlains() {
  const c = canvas();
  skyGradient(c, [88, 142, 222], P.skySunset, 0.62);
  clouds(c, 30, 7, 11, [246, 226, 214], [222, 198, 190]);
  // ⚠️ 地平线必须压到画面**底部**（约 85%）。
  //    MC 的第一人称视角是 FOV 70 的站立高度，天空天然占大半画面。
  //    第一版把地平线放在 60% 处 → 前景泥土占了 40% 屏幕，
  //    看起来像"贴着地面的特写"，完全不像 MC 截图。
  const HORIZON = 205;
  // 远山：一条暗绿色带，只在天空里露出一层轮廓
  const far = heightmap(c, HORIZON - 26, 1.9, 21);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = far[x]; y <= HORIZON + 1; y += 1) put(c, x, y, shade(P.leaf, 0.66));
  }
  // 中景：稍亮的一层，做出纵深
  const mid = heightmap(c, HORIZON - 10, 1.5, 23);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = mid[x]; y <= HORIZON + 1; y += 1) put(c, x, y, shade(P.leaf, 0.84));
  }
  // 前景地面：只有画面底部一条
  const hs = foregroundGround(c, HORIZON, 2, 22);
  // 一小片沙地 + 一个水塘（让底部不只是纯草）
  for (let x = 150; x < 208; x += 1) {
    for (let y = hs[x]; y <= hs[x] + 2; y += 1) put(c, x, y, y === hs[x] ? P.sand : P.sandDark);
  }
  const pondX0 = 32, pondX1 = 118;
  for (let x = pondX0; x <= pondX1; x += 1) {
    // 塘沿比地面低 2~3 像素，做出"凹陷"
    const top = hs[x] + 2 + (((x - pondX0) % 5 === 0) ? 1 : 0);
    for (let y = top; y < c.h; y += 1) {
      put(c, x, y, (y - top) < 3 ? P.water : shade(P.waterDeep, 1 - (y - top) * 0.02));
    }
  }
  // 树：从各自地表长出（树高按 MC 的橡树比例，不要太高）
  for (const [tx, hgt, sd] of [[52, 12, 31], [252, 15, 32], [318, 10, 33], [130, 9, 34]]) {
    tree(c, tx, hs[tx], hgt, sd);
  }
  return c;
}

/** 2. 夜晚星空 —— 带月亮与火把点光 */
function sceneNight() {
  const c = canvas();
  skyGradient(c, P.skyNight, [26, 34, 74]);
  const rng = makeRng(41);
  for (let i = 0; i < 380; i += 1) {
    const x = (rng() * c.w) | 0;
    const y = (rng() * 150) | 0;
    const b = 180 + ((rng() * 75) | 0);
    put(c, x, y, [b, b, Math.min(255, b + 12)]);
  }
  // 月亮：方形（MC 的月亮就是方的）+ 暗斑
  rect(c, 296, 24, 326, 54, P.moon);
  rect(c, 302, 32, 308, 38, shade(P.moon, 0.86));
  rect(c, 316, 44, 321, 49, shade(P.moon, 0.9));
  const HORIZON = 205;
  const far = heightmap(c, HORIZON - 22, 1.8, 51);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = far[x]; y <= HORIZON + 1; y += 1) put(c, x, y, shade(P.leaf, 0.2));
  }
  const hs = foregroundGround(c, HORIZON, 2, 52, {
    top: shade(P.grassTop, 0.4), side: shade(P.grassSide, 0.4),
    body: shade(P.dirt, 0.38), body2: shade(P.dirtDark, 0.36)
  });
  for (const [tx, hgt, sd] of [[86, 13, 61], [300, 11, 62]]) tree(c, tx, hs[tx], hgt, sd);
  // 火把：木杆 + 顶部亮黄 + 周围暖色光点
  const tx = 190;
  const ty = hs[tx];
  for (let y = ty - 9; y < ty; y += 1) put(c, tx, y, P.woodOak);
  put(c, tx, ty - 10, P.torch);
  for (let i = 0; i < 130; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 20;
    const x = Math.round(tx + Math.cos(a) * r);
    const y = Math.round(ty - 10 + Math.sin(a) * r * 0.8);
    if (rng() < 0.5) put(c, x, y, [255, 205 + ((rng() * 40) | 0), 120]);
  }
  return c;
}

/** 3. 洞穴火把 —— 封闭、暖光、有矿石 */
function sceneCave() {
  const c = canvas();
  rect(c, 0, 0, c.w - 1, c.h - 1, [38, 36, 40]);
  const rng = makeRng(71);
  // 石壁：大块噪点，深板岩与石头混在一起
  for (let y = 0; y < c.h; y += 1) {
    for (let x = 0; x < c.w; x += 1) {
      const r = rng();
      put(c, x, y, r < 0.14 ? P.deepslate : (r < 0.34 ? P.stoneDark : P.stone));
    }
  }
  // 挖出一条洞穴空腔（椭圆 + 抖动边缘，做出不规则感）
  const cx = 200, cy = 130, rx = 150, ry = 62;
  for (let y = 0; y < c.h; y += 1) {
    for (let x = 0; x < c.w; x += 1) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1 - rng() * 0.12) put(c, x, y, [24, 20, 24]);
    }
  }
  // 顶部钟乳石 / 底部石笋
  const hm = heightmap(c, 62, 2.2, 81);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = 0; y < hm[x]; y += 1) put(c, x, y, y < 8 ? [30, 28, 32] : P.stoneDark);
  }
  const hm2 = heightmap(c, 176, 2.0, 82);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = hm2[x]; y < c.h; y += 1) put(c, x, y, P.stone);
  }
  // 矿石：三种颜色点缀（煤/铁/金），让洞穴不空
  const ores = [[30, 30, 34], [196, 152, 120], [232, 190, 80]];
  for (let i = 0; i < 46; i += 1) {
    const x = 12 + ((rng() * (c.w - 24)) | 0);
    const y = 8 + ((rng() * (c.h - 16)) | 0);
    const col = ores[(rng() * ores.length) | 0];
    const n = 2 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k += 1) put(c, x + ((rng() * 3) | 0) - 1, y + ((rng() * 3) | 0) - 1, col);
  }
  // 火把 + 暖光（洞穴里最像 MC 的一笔）
  const tx = 150, ty = 168;
  for (let y = ty - 14; y < ty; y += 1) put(c, tx, y, P.woodOak);
  put(c, tx, ty - 15, P.torch);
  for (let y = 0; y < c.h; y += 1) {
    for (let x = 0; x < c.w; x += 1) {
      const d = Math.hypot(x - tx, (y - (ty - 15)) * 1.35);
      if (d > 118) continue;
      const k = 1 + (1 - d / 118) * 0.85;
      const [r, g, b] = get(c, x, y);
      put(c, x, y, [Math.min(255, r * k), Math.min(255, g * k * 0.97), Math.min(255, b * k * 0.78)]);
    }
  }
  return c;
}

/** 4. 森林湖泊 —— 水面倒影，画面上半是树冠 */
function sceneLake() {
  const c = canvas();
  skyGradient(c, [98, 148, 216], [176, 204, 236], 0.55);
  clouds(c, 22, 6, 91);
  const HORIZON = 150;              // 岸线：湖面在它下方
  const far = heightmap(c, HORIZON - 20, 1.6, 92);
  for (let x = 0; x < c.w; x += 1) {
    for (let y = far[x]; y <= HORIZON; y += 1) put(c, x, y, shade(P.leafDark, 0.78));
  }
  const hs = foregroundGround(c, HORIZON, 2, 93);
  // 岸边一排树（"森林"）：树干从各自地表长出，高度错开
  for (let i = 0; i < 8; i += 1) {
    const x = 14 + i * 48 + ((i * 13) % 15);
    tree(c, x, hs[x], 16 + ((i * 7) % 10), 100 + i);
  }
  // 湖面：从岸线稍下开始
  const wy0 = HORIZON + 5;
  water(c, wy0, c.h - 1, 95);
  // 倒影：把岸线以上的内容竖向镜像、压暗加蓝，画进水面顶部
  for (let x = 0; x < c.w; x += 1) {
    for (let k = 1; k <= 26; k += 1) {
      const srcY = HORIZON - k;
      const dstY = wy0 + k - 1;
      if (dstY >= c.h || srcY < 0) break;
      const [r, g, b] = get(c, x, srcY);
      const fade = 0.7 - k * 0.016;                 // 越远越淡
      put(c, x, dstY, [
        (r * fade + 40 * (1 - fade)) | 0,
        (g * fade + 70 * (1 - fade)) | 0,
        (b * fade + 120 * (1 - fade)) | 0
      ]);
    }
  }
  return c;
}

/** 5. 台地峡谷 —— 橙红色调，和前面几张反差最大 */
function sceneMesa() {
  const c = canvas();
  skyGradient(c, [176, 150, 190], [248, 206, 150], 0.45);
  clouds(c, 24, 6, 111, [252, 236, 220], [230, 206, 190]);
  // 层理台地：从远到近叠几条高度不同的横带，每条一个明度 → 出层次
  const bands = [
    { h: 108, amp: 1.0, seed: 121, k: 0.80 },
    { h: 124, amp: 1.2, seed: 122, k: 0.92 },
    { h: 140, amp: 1.0, seed: 123, k: 0.70 },
    { h: 156, amp: 1.1, seed: 124, k: 1.02 }
  ];
  for (const b of bands) {
    const hs = heightmap(c, b.h, b.amp, b.seed);
    for (let x = 0; x < c.w; x += 1) {
      for (let y = hs[x]; y < c.h; y += 1) {
        const rng = ((x * 31 + y * 17) % 11) / 11;
        put(c, x, y, shade(rng < 0.25 ? P.mesaDark : P.mesa, b.k));
      }
    }
  }
  // 近景谷底：干涸河道（沙）
  foregroundGround(c, 176, 3, 131, {
    top: P.sand, side: P.sandDark, body: P.sandDark, body2: shade(P.sandDark, 0.9)
  });
  // 几株枯木（台地最典型的点缀）
  for (const [x, gy, hgt] of [[58, 176, 16], [212, 174, 13], [332, 175, 18]]) {
    for (let y = gy - hgt; y <= gy; y += 1) put(c, x, y, shade(P.woodDark, 0.95));
    put(c, x, gy - hgt - 2, shade(P.woodDark, 0.9));
    put(c, x - 3, gy - hgt + 4, shade(P.woodDark, 0.9));
    put(c, x + 4, gy - hgt + 6, shade(P.woodDark, 0.9));
  }
  return c;
}

const SCENES = [
  { file: 'plains-dawn', name: '平原日出', make: scenePlains },
  { file: 'night-stars', name: '夜晚星空', make: sceneNight },
  { file: 'cave-torch', name: '洞穴火把', make: sceneCave },
  { file: 'forest-lake', name: '森林湖泊', make: sceneLake },
  { file: 'mesa-canyon', name: '台地峡谷', make: sceneMesa }
];

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const s of SCENES) {
  const c = s.make();
  const up = upscale(c);
  const png = encodePng(up.data, up.w, up.h);
  const file = path.join(OUT, `${s.file}.png`);
  fs.writeFileSync(file, png);
  // 缩略图（列表里展示用）：再降采样成 160×90 的 24bit PNG，体积很小
  const tw = 160;
  const th = 90;
  const thumb = Buffer.alloc(tw * th * 3);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const sx = Math.min(c.w - 1, ((x / tw) * c.w) | 0);
      const sy = Math.min(c.h - 1, ((y / th) * c.h) | 0);
      const [r, g, b] = get(c, sx, sy);
      const i = (y * tw + x) * 3;
      thumb[i] = r; thumb[i + 1] = g; thumb[i + 2] = b;
    }
  }
  const tpng = encodePng(thumb, tw, th);
  fs.writeFileSync(path.join(OUT, `${s.file}.thumb.png`), tpng);
  report.push({ name: s.name, file: s.file, kb: +(png.length / 1024).toFixed(0), tkb: +(tpng.length / 1024).toFixed(1) });
}

console.log(`生成背景图（${W * SCALE}×${H * SCALE}，像素画 ${W}×${H} × ${SCALE}）：`);
for (const r of report) console.log(`  ${r.name.padEnd(6)} ${r.file.padEnd(14)} ${String(r.kb).padStart(5)} KB  (缩略图 ${r.tkb} KB)`);
console.log(`\n共 ${report.length} 张，合计 ${report.reduce((a, b) => a + b.kb, 0)} KB → ${OUT}`);
