// ═══════════════════════════════════════════════════════════════════════════
// 12-color-format.js — 颜色格式互转（HEX / RGB / HSL / 颜色名）
// ═══════════════════════════════════════════════════════════════════════════
// 用户要求（2026-10-04）："选色界面不要用小按钮来让用户切换 RGB/HEX/HSL，
//   而是大大方方的全部罗列出来，填哪个就自动补充其他格式的内容"。
//
// 所以这里只做一件事：**解析任意常见颜色写法 → 统一表示为 {r,g,b,a} → 再输出三种格式**。
// 输入框三个（HEX / RGB / HSL）同时可见、同时可编辑，任一变更就把另两个补齐。
//
// 支持解析：
//   #rgb #rgba #rrggbb #rrggbbaa
//   rgb(r g b)  rgb(r,g,b)  rgba(r,g,b,a)  百分比与 0~1 alpha
//   hsl(h s% l%)  hsla(h,s%,l%,a)
//   颜色关键字（只用浏览器自己解析：挂个探针读 computedStyle）
// 解析不出来就返回 null，由调用方决定"保留用户输入、不联动"（不硬塞一个错值）。
'use strict';

(function colorFormat() {
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** 把 0~255 转成两位十六进制 */
  const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

  /** α：省略 / 1 → 不输出；否则保留两位小数 */
  const alphaStr = (a) => (a === undefined || a === null || a >= 1 ? '' : String(Math.round(a * 100) / 100));

  function parseAlpha(raw) {
    if (raw === undefined || raw === null || raw === '') return 1;
    const s = String(raw).trim();
    if (s.endsWith('%')) return clamp(parseFloat(s) / 100, 0, 1);
    const v = parseFloat(s);
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  }

  /** HSL → RGB（h:0~360, s/l:0~1） */
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  /** RGB → HSL（返回 h:0~360, s/l:0~100 便于展示） */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  /**
   * 解析任意颜色写法 → { r, g, b, a }（r/g/b 0~255，a 0~1）。
   * @returns {{r:number,g:number,b:number,a:number}|null}
   */
  function parse(input) {
    if (input === null || input === undefined) return null;
    const s = String(input).trim();
    if (!s) return null;

    // #rgb / #rgba / #rrggbb / #rrggbbaa
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      const h = m[1];
      const ex = (i, len) => parseInt(len === 1 ? h[i] + h[i] : h.slice(i, i + 2), 16);
      if (h.length === 3 || h.length === 4) {
        return { r: ex(0, 1), g: ex(1, 1), b: ex(2, 1), a: h.length === 4 ? ex(3, 1) / 255 : 1 };
      }
      if (h.length === 6 || h.length === 8) {
        return {
          r: ex(0, 2), g: ex(2, 2), b: ex(4, 2),
          a: h.length === 8 ? ex(6, 2) / 255 : 1
        };
      }
      return null;
    }

    // rgb() / rgba()：支持逗号与空格两种写法、支持百分比
    m = /^rgba?\(\s*([^)]+)\)$/i.exec(s);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const chan = (raw) => {
        const t = String(raw).trim();
        if (t.endsWith('%')) return clamp(parseFloat(t) / 100 * 255, 0, 255);
        return clamp(parseFloat(t), 0, 255);
      };
      const r = chan(parts[0]), g = chan(parts[1]), b = chan(parts[2]);
      if (![r, g, b].every(Number.isFinite)) return null;
      return { r, g, b, a: parseAlpha(parts[3]) };
    }

    // hsl() / hsla()
    m = /^hsla?\(\s*([^)]+)\)$/i.exec(s);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const h = parseFloat(parts[0]);
      const sp = parseFloat(parts[1]) / 100;
      const lp = parseFloat(parts[2]) / 100;
      if (![h, sp, lp].every(Number.isFinite)) return null;
      const [r, g, b] = hslToRgb(h, clamp(sp, 0, 1), clamp(lp, 0, 1));
      return { r, g, b, a: parseAlpha(parts[3]) };
    }

    // 颜色关键字等交给浏览器：挂探针读 computedStyle 的 color。
    // ⚠️ 必须用**哨兵色**判断"浏览器到底认不认这个值"：
    //   探针上写 `color: not-a-color`，浏览器**直接丢弃该声明**，computedStyle 于是回落到
    //   上一个有效声明（先是继承值 rgb(0,0,0)，若不设哨兵就是我们设过的值）。
    //   若直接采信结果，任何乱码都会被解析成**黑色** —— 用户在 HEX 框里打错一个字，
    //   颜色就被悄悄改成黑（实测踩到，而且会写进 localStorage）。
    //   正确判据：先设一个绝不可能撞上的哨兵色，再用 setProperty 覆盖成用户输入；
    //   结果仍等于哨兵 → 声明被丢弃 → 判为非法。
    try {
      const SENTINEL = 'rgb(1, 2, 3)';
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0';
      probe.style.setProperty('color', SENTINEL);
      document.documentElement.appendChild(probe);
      probe.style.setProperty('color', s);          // 非法值会被浏览器丢弃
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      if (rgb === SENTINEL) return null;            // 声明被丢弃 → 非法
      const mm = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(rgb);
      if (mm) return { r: Number(mm[1]), g: Number(mm[2]), b: Number(mm[3]), a: mm[4] === undefined ? 1 : Number(mm[4]) };
    } catch { /* 忽略 */ }
    return null;
  }

  /** {r,g,b,a} → '#rrggbb'（取色器只认这个格式，α 单独处理） */
  function toHex(c) { return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : ''; }

  /** {r,g,b,a} → '#rrggbbaa'（有 α 时） */
  function toHexA(c) {
    if (!c) return '';
    const a = alphaStr(c.a);
    return `${toHex(c)}${a === '' ? '' : hex2(c.a * 255)}`;
  }

  /** {r,g,b,a} → 'rgb(r, g, b)' / 'rgba(r, g, b, a)' */
  function toRgb(c) {
    if (!c) return '';
    const a = alphaStr(c.a);
    return a === ''
      ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
      : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
  }

  /** {r,g,b,a} → 'hsl(h, s%, l%)' / 'hsla(...)' */
  function toHsl(c) {
    if (!c) return '';
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    const a = alphaStr(c.a);
    return a === '' ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`;
  }

  /** 一次性给出三种格式（供"三个输入框同时补齐"） */
  function all(input) {
    const c = parse(input);
    if (!c) return null;
    return { parsed: c, hex: toHexA(c), rgb: toRgb(c), hsl: toHsl(c), picker: toHex(c) };
  }

  window.qqaColorFormat = { parse, toHex, toHexA, toRgb, toHsl, all, rgbToHsl, hslToRgb };
})();
