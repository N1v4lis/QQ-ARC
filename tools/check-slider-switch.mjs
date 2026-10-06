// 两个已修 bug 的回归断言（用户截图里的具体问题）：
//   BUG1 活跃设置的峰谷滑条"被干飞" —— 滑块被 transform 与 left% 同时定位
//   BUG2 开关错位 —— .track 被峰谷样式污染成 6px 高、宽度被撑开
// 这两条都用**计算样式 + 几何**取证，不靠肉眼。
// 用法：node tools/check-slider-switch.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  // ⚠️ 用 waitFor 而不是固定 sleep（2026-10-04 修）：启动默认落在「仪表盘」，
  //    它的 /api/usage/stats 冷启动要 5 秒多；固定 sleep 期间设置页可能还没渲染，
  //    菜单点不到 → 量到的开关全是"不存在"。
  // ⚠️ 必须等启动遮罩摘除再点页签：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时。
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '导航渲染' });
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="chat"]')`, { timeout: 20000, label: '设置菜单' });
  // ⚠️ 为什么用「聊天设置」而不是「工具与技能」量开关（2026-10-04 改）：
  //   工具区确实有 14 个开关，但它们全在**关闭的折叠卡**里，
  //   而折叠卡关闭时内容是 `display:none`（这正是修的"遮挡"问题）→ 可见开关数 = 0。
  //   「聊天设置」卡头里有 2 个开关（峰谷时段 / 统一设置），在卡头内、始终可见。
  //   实测各区块可见开关数：chat=2、tools=14(全在关闭卡内→实际 0)、其余为 0。
  //   所以这里选 chat；要量"一排开关"的形态请先展开卡，或另开用例。
  await page.click('.settings-menu-item[data-section="chat"]');
  // ⚠️ 等**区块真的渲染出来**再量：菜单项"存在"不等于"点它会立刻渲染完" ——
  //    `page.click` 返回后 #ac-editor 可能还是空的（实测偶发），
  //    于是"可见开关 = 0"被判失败。先等编辑器有内容。
  await page.waitFor(`(() => {
    const ed = document.getElementById('ac-editor');
    return !!ed && ed.innerHTML.trim().length > 0;
  })()`, { timeout: 25000, label: '聊天设置区块渲染' });
  await page.waitFor(`[...document.querySelectorAll('.switch .track')].some((t) => t.getBoundingClientRect().width > 0)`, { timeout: 25000, label: '可见开关' });
  // ⚠️ 峰谷滑条在「活跃设置」折叠卡**内部**，卡关闭时整块 display:none。
  //    所以量滑条前必须先把它展开（点卡头；卡头里的开关/按钮会 stopPropagation，
  //    点标题区域即可）。展开后再等滑条出现。
  await page.eval(`(() => {
    const card = document.getElementById('card-active-config');
    if (card && !card.classList.contains('open')) {
      const h = card.querySelector('.fold-head');
      if (h) h.click();
    }
    return 1;
  })()`);
  await page.waitFor(`(() => {
    const s = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    return r.width > 100 && r.height > 10;
  })()`, { timeout: 20000, label: '峰谷滑条可见' });

  // ── 开关 ──────────────────────────────────────────────────────────────
  // ⚠️ 必须挑一个**真正被渲染**的开关（2026-10-04 修）：
  //   折叠卡关闭时内容现在是 `display:none`（这本身就是修的"遮挡"问题），
  //   而 `document.querySelector('.switch')` 会命中最靠前的那个 ——
  //   它很可能在折叠卡内部，于是几何全是 0x0，断言误报"轨道被压成细线"。
  //   所以先按可见性过滤（有盒子 + 轨道尺寸非 0）再取第一个。
  const sw = await page.eval(`(() => {
    const visible = [...document.querySelectorAll('.switch')].filter((el) => {
      const track = el.querySelector('.track');
      if (!track) return false;
      const r = track.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = visible[0];
    if (!el) return { found: false, total: document.querySelectorAll('.switch').length };
    const track = el.querySelector('.track');
    const thumb = el.querySelector('.thumb');
    const input = el.querySelector('input[type=checkbox]');
    const tr = track ? track.getBoundingClientRect() : null;
    const th = thumb ? thumb.getBoundingClientRect() : null;
    const cs = track ? getComputedStyle(track) : null;
    const ts = thumb ? getComputedStyle(thumb) : null;
    return {
      found: true,
      totalVisible: visible.length,
      total: document.querySelectorAll('.switch').length,
      hasInput: !!input,
      trackW: tr ? Math.round(tr.width) : 0,
      trackH: tr ? Math.round(tr.height) : 0,
      thumbW: th ? Math.round(th.width) : 0,
      thumbLeft: th && tr ? Math.round(th.left - tr.left) : 0,
      trackRadius: cs ? cs.borderRadius : null,
      thumbRadius: ts ? ts.borderRadius : null,
      switchW: Math.round(el.getBoundingClientRect().width)
    };
  })()`);
  if (!sw.found) { ok('设置页存在可见开关', false); return; }
  ok('开关有真实复选框（状态驱动）', sw.hasInput, `input=${sw.hasInput}`);
  ok('开关轨道是胶囊而不是细线', sw.trackH >= 20 && sw.trackH <= 26, `track=${sw.trackW}x${sw.trackH}（可见 ${sw.totalVisible}/${sw.total} 个）`);
  ok('开关轨道宽度正常（40px 量级，未被撑开）', sw.trackW >= 34 && sw.trackW <= 46, `width=${sw.trackW}px`);
  ok('滑块是圆形', sw.thumbRadius === '50%', `radius=${sw.thumbRadius}`);
  ok('滑块在轨道内（未溢出错位）', sw.thumbLeft >= 0 && sw.thumbLeft + sw.thumbW <= sw.trackW + 1,
    `thumb left=${sw.thumbLeft} w=${sw.thumbW} / track=${sw.trackW}`);

  // ── 滑块位移：静态交叉验证（最可靠）────────────────────────────────────
  // 为什么不做"勾一下再读两次"：这些开关的 change 会触发保存 + 重新渲染表单，
  // 而如果改属性绕过事件，computedStyle 与强制回流之间又会被浏览器的样式缓存
  // 吃掉中间态（实测 off/mid/on 三次读到同一个矩阵，但 CSS 明明是对的 ——
  // 用 probe-switch.mjs 静态对比同一页两种状态的开关，结论清清楚楚）。
  // 所以这里改为：**同一页里同时存在勾选与未勾选的开关**时，直接比它们的位移。
  const cross = await page.eval(`(() => {
    const rows = [];
    for (const s of document.querySelectorAll('.switch')) {
      const i = s.querySelector('input[type=checkbox]');
      const t = s.querySelector('.thumb');
      if (!i || !t) continue;
      rows.push({ checked: i.checked, transform: getComputedStyle(t).transform });
    }
    const on = rows.filter((x) => x.checked);
    const off = rows.filter((x) => !x.checked);
    return { total: rows.length, onCount: on.length, offCount: off.length, onT: on[0]?.transform ?? null, offT: off[0]?.transform ?? null };
  })()`);

  if (cross.onCount && cross.offCount) {
    ok('勾选/未勾选的滑块位置不同（CSS 状态驱动正常）', cross.onT !== cross.offT,
      `checked=${cross.onT} / unchecked=${cross.offT}（样本 ${cross.total} 个）`);
  } else {
    // 只有一种状态时，切到"工具与技能"分区（那里有 13 勾选 + 1 未勾选，实测）
    await page.click('.settings-menu-item[data-section="tools"]');
    await sleep(1500);
    const cross2 = await page.eval(`(() => {
      const rows = [];
      for (const s of document.querySelectorAll('.switch')) {
        const i = s.querySelector('input[type=checkbox]');
        const t = s.querySelector('.thumb');
        if (!i || !t) continue;
        rows.push({ checked: i.checked, transform: getComputedStyle(t).transform });
      }
      const on = rows.filter((x) => x.checked);
      const off = rows.filter((x) => !x.checked);
      return { total: rows.length, onCount: on.length, offCount: off.length, onT: on[0]?.transform ?? null, offT: off[0]?.transform ?? null };
    })()`);
    ok('勾选/未勾选的滑块位置不同（切到工具页后交叉验证）',
      cross2.onCount > 0 && cross2.offCount > 0 && cross2.onT !== cross2.offT,
      `checked=${cross2.onT} / unchecked=${cross2.offT}（样本 ${cross2.total} 个）`);
  }
  // 回到聊天设置，继续测滑条
  await page.click('.settings-menu-item[data-section="chat"]');
  await sleep(1400);

  // ── 峰谷滑条（设置 → 聊天设置）───────────────────────────────────────
  await page.click('.settings-menu-item[data-section="chat"]');
  await sleep(1500);
  const slider = await page.eval(`(() => {
    const scale = document.querySelector('.tier-scale');
    if (!scale) return { found: false };
    const sr = scale.getBoundingClientRect();
    const knobs = [...scale.querySelectorAll('.tier-knob')].map((k) => {
      const r = k.getBoundingClientRect();
      const cs = getComputedStyle(k);
      return {
        cls: k.className,
        leftPct: k.style.left,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        top: cs.top, transform: cs.transform, position: cs.position
      };
    });
    const bands = [...scale.querySelectorAll('.tier-band')].map((b) => {
      const r = b.getBoundingClientRect();
      return { cls: b.className, w: Math.round(r.width), text: (b.textContent || '').trim().slice(0, 6), display: getComputedStyle(b).display };
    });
    return {
      found: true,
      scale: { x: Math.round(sr.x), w: Math.round(sr.width), h: Math.round(sr.height) },
      knobs, bands
    };
  })()`);

  if (!slider.found) { ok('聊天设置里存在峰谷滑条', false); return; }
  ok('滑条容器尺寸正常', slider.scale.w > 200 && slider.scale.h >= 30, `${slider.scale.w}x${slider.scale.h}`);
  ok('滑条上有档位区间（含数字）', slider.bands.length >= 4 && slider.bands.every((b) => b.display === 'flex'),
    `band 数 ${slider.bands.length}，display=${slider.bands.map((b) => b.display).join('/')}`);

  for (const k of slider.knobs) {
    // 双档模式下 .knob-peak 可能是 display:none（单档时不需要峰值滑块），跳过不报
    if (k.w === 0 && k.h === 0) {
      ok(`滑块 ${k.cls} 当前隐藏（单档模式，属正常）`, true, 'display:none');
      continue;
    }
    const inScale = k.h >= 20 && k.h <= 44 && k.w <= 10;
    ok(`滑块 ${k.cls} 尺寸合理（竖条，未被变形）`, inScale, `w=${k.w} h=${k.h} transform=${k.transform}`);
  }
  // 关键：可见滑块必须落在轨道水平范围内
  const scaleLeft = slider.scale.x;
  const scaleRight = slider.scale.x + slider.scale.w;
  for (const k of slider.knobs) {
    if (k.w === 0 && k.h === 0) continue;
    const inside = k.x >= scaleLeft - 6 && k.x <= scaleRight + 6;
    ok(`滑块 ${k.cls} 落在轨道内（未被"干飞"）`, inside,
      `knob.x=${k.x}, 轨道 ${scaleLeft}..${scaleRight}（宽 ${slider.scale.w}）`);
  }
  await page.screenshot('shots/final/settings-slider.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n滑条与开关全部正常。');
process.exit(failed ? 2 : 0);
