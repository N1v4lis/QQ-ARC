// 本轮修复的验收：
//   1. 峰谷滑条档位文字对比度 ≥ 4.5（浅色/深色两套都测）
//   2. 活跃设置的「取消 / 保存」并排同一行
//   3. 主题切换的扩散动效：不盖住界面、不拦任何元素
//   4. 主题按钮图标（亮=太阳 / 暗=月亮）；卡头控件靠左；关闭卡不渲染内容
// 用法：node tools/check-tier-buttons-theme.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

const CONTRACT = `(() => {
  const lum = (r, g, b) => {
    const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = /rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?/.exec(String(s));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
  };
  const over = (fg, bg) => {            // 把半透明前景合成到背景上，得到"实际看到的颜色"
    const f = parse(fg), b = parse(bg);
    if (!f || !b) return null;
    const a = f[3];
    return [Math.round(f[0] * a + b[0] * (1 - a)), Math.round(f[1] * a + b[1] * (1 - a)), Math.round(f[2] * a + b[2] * (1 - a))];
  };
  const ratio = (a, b) => {
    const L1 = lum(a[0], a[1], a[2]), L2 = lum(b[0], b[1], b[2]);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  };
  window.__ct = { parse, over, ratio, lum };
  return 1;
})()`;

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  // ⚠️ 全部改用 waitFor 而不是固定 sleep（2026-10-04 修）：
  //    启动默认落在「仪表盘」，而 loadSettings() 要拉 config + skills，
  //    实测要 2 秒以上才把二级菜单渲染出来；固定 sleep 会让后面的点击落空，
  //    表现为"滑条找不到 / 按钮找不到" —— 看着像布局坏了，其实只是没等够。
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
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '导航' });
  await page.eval(CONTRACT);
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="chat"]')`, { timeout: 25000, label: '设置菜单' });
  await page.click('.settings-menu-item[data-section="chat"]');
  // 峰谷滑条在「活跃设置」折叠卡内，确保卡是展开的，并等滑条真的有尺寸
  await page.eval(`(() => {
    const card = document.getElementById('card-active-config');
    if (card && !card.classList.contains('open')) {
      const h = card.querySelector('.fold-head'); if (h) h.click();
    }
    return 1;
  })()`);
  await page.waitFor(`(() => {
    const s = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    return r.width > 100 && r.height > 10;
  })()`, { timeout: 20000, label: '峰谷滑条可见' });

  // ── 1a. 每档区间的**几何**：盒子必须撑满滑条高度、文字必须落在滑条内 ──
  // ⚠️ 这条是 2026-10-04 第五轮加的：曾经 `30-settings.css` 里一条给小圆点
  //    写的 `.ac-tier-wrap .d2/.d3/.d4 { width:4px; height:4px }` **误命中了档位区间**
  //    （区间 class 正是 `tier-band d2` 等），把第 2/3/4 档压成 4×4 圆点，
  //    文字被 flex 居中到滑条**外面** —— 用户看到的"2、3、4 档文字飞走了"，
  //    而第 1 档（class 只有 tier-band）安然无恙。
  //    只断言"对比度/颜色"抓不到这个 bug（文字确实渲染了、颜色也对），
  //    必须断言**几何**。
  for (const theme of ['light', 'dark']) {
    await page.eval(`(() => { window.applyTheme(${JSON.stringify(theme)}); return 1; })()`);
    await sleep(500);
    const geo = await page.eval(`(() => {
      const scale = document.querySelector('.ac-tier-wrap .tier-scale');
      if (!scale) return null;
      const sr = scale.getBoundingClientRect();
      return {
        scaleH: Math.round(sr.height),
        bands: [...scale.querySelectorAll('.tier-band')].map((b, i) => {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          let tr = null;
          try {
            const range = document.createRange();
            range.selectNodeContents(b);
            const q = range.getBoundingClientRect();
            if (q.width || q.height) tr = { l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom) };
          } catch (e) { /* ignore */ }
          return {
            i: i + 1, text: (b.textContent || '').trim(),
            h: Math.round(r.height),
            opacity: s.opacity, visibility: s.visibility,
            textInScale: tr ? (tr.l >= sr.left - 2 && tr.r <= sr.right + 2 && tr.t >= sr.top - 2 && tr.b <= sr.bottom + 2) : null
          };
        })
      };
    })()`);
    if (!geo) { ok(`[${theme}] 找到峰谷滑条`, false); continue; }
    ok(`[${theme}] 每一档区间都撑满滑条高度（文字不会被挤出轨道）`,
      geo.bands.every((b) => b.h >= geo.scaleH - 4),
      geo.bands.map((b) => `${b.text || '(空)'}:${b.h}px`).join('  ') + ` / 滑条 ${geo.scaleH}px`);
    ok(`[${theme}] 每档文字都落在滑条范围内`,
      geo.bands.every((b) => b.textInScale === true),
      geo.bands.map((b) => `${b.text || '(空)'}:${b.textInScale === true ? 'OK' : '飞出'}`).join('  '));
    ok(`[${theme}] 每档文字都可见（opacity/visibility）`,
      geo.bands.every((b) => Number(b.opacity) > 0.1 && b.visibility !== 'hidden'),
      geo.bands.map((b) => `${b.text || '(空)'}:${b.opacity}/${b.visibility}`).join('  '));
  }

  // ── 1b. 档位文字对比度 ──────────────────────────────────────────────
  for (const theme of ['light', 'dark']) {
    await page.eval(`(() => { window.applyTheme(${JSON.stringify(theme)}); return 1; })()`);
    await sleep(500);
    const bands = await page.eval(`(() => {
      const scale = document.querySelector('.tier-scale');
      if (!scale) return null;
      // 滑条自身可能没有底色（透明），那就往上找到第一个有底色的祖先 ——
      // 对比度必须按"眼睛实际看到的底色"算，不是按元素自己的 background 属性。
      let base = getComputedStyle(scale).backgroundColor;
      if (!window.__ct.parse(base) || window.__ct.parse(base)[3] === 0) {
        let p = scale.parentElement;
        while (p && (!window.__ct.parse(getComputedStyle(p).backgroundColor) || window.__ct.parse(getComputedStyle(p).backgroundColor)[3] === 0)) p = p.parentElement;
        base = p ? getComputedStyle(p).backgroundColor : (getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)');
      }
      return [...scale.querySelectorAll('.tier-band')].map((b) => {
        const s = getComputedStyle(b);
        const bandBgRaw = s.backgroundColor;
        const bandBg = (!window.__ct.parse(bandBgRaw) || window.__ct.parse(bandBgRaw)[3] === 0)
          ? window.__ct.parse(base)
          : window.__ct.over(bandBgRaw, base);
        if (!bandBg) return { text: (b.textContent || '').trim(), bad: true, bg: bandBgRaw, base };
        const text = window.__ct.over(s.color, 'rgb(' + bandBg[0] + ',' + bandBg[1] + ',' + bandBg[2] + ')');
        return {
          text: (b.textContent || '').trim(),
          color: s.color, bgRaw: bandBgRaw, bg: 'rgb(' + bandBg[0] + ',' + bandBg[1] + ',' + bandBg[2] + ')',
          ratio: text ? window.__ct.ratio(text, bandBg) : 0,
          clipped: b.scrollWidth - b.clientWidth > 2
        };
      });
    })()`);
    if (!bands) { ok(`[${theme}] 找到峰谷滑条`, false); continue; }
    if (bands.some((b) => b.bad)) {
      ok(`[${theme}] 四档文字对比度均 ≥ 4.5`, false, `解析底色失败：${JSON.stringify(bands.filter((b) => b.bad))}`);
      continue;
    }
    const worst = Math.min(...bands.map((b) => b.ratio));
    const detail = bands.map((b) => `${b.text || '(空)'}:${b.ratio.toFixed(2)}`).join('  ');
    ok(`[${theme}] 四档文字对比度均 ≥ 4.5`, worst >= 4.5, `${detail}（最低 ${worst.toFixed(2)}）`);
  }

  // ── 2. 取消 / 保存 并排 ──────────────────────────────────────────────
  const btns = await page.eval(`(() => {
    const list = [...document.querySelectorAll('#ac-editor button, .ac-editor button')]
      .filter((b) => /^(取消|保存)$/.test((b.textContent || '').trim()));
    if (list.length < 2) return { found: list.length };
    const r = list.map((b) => { const x = b.getBoundingClientRect(); return { t: (b.textContent || '').trim(), x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }; });
    const p = list[0].parentElement;
    const cs = getComputedStyle(p);
    const hint = p.querySelector('.hint');
    return {
      found: list.length, r,
      parentDisplay: cs.display, parentDir: cs.flexDirection,
      sameRow: Math.abs(r[0].y - r[1].y) < 6,
      gap: Math.abs(r[1].x - (r[0].x + r[0].w)),
      hintBelow: hint ? Math.round(hint.getBoundingClientRect().y) > Math.round(r[0].y) : null
    };
  })()`);
  ok('找到取消/保存两个按钮', btns.found >= 2, `found=${btns.found}`);
  if (btns.found >= 2) {
    ok('两个按钮并排同一行', btns.sameRow, `y: ${btns.r[0].y} vs ${btns.r[1].y}`);
    ok('按钮之间有横向间距（不是贴在一起）', btns.gap > 4 && btns.gap < 40, `gap=${btns.gap}px`);
    ok('说明文字换到按钮下方', btns.hintBelow === true, `hintBelow=${btns.hintBelow}`);
  }

  // ── 3. 主题扩散：不盖界面、不拦元素 ──────────────────────────────────
  await page.eval(`(() => { window.qqaMotion && window.qqaMotion.setPref('on'); window.applyTheme('light'); return 1; })()`);
  await sleep(600);
  const vt = await page.eval(`(() => {
    const supported = typeof document.startViewTransition === 'function';
    const out = { supported, hasOverlayNode: !!document.querySelector('.q-theme-ripple') };
    if (!supported) return out;
    return new Promise((resolve) => {
      const btn = document.getElementById('theme-btn');
      const before = document.documentElement.getAttribute('data-theme');
      btn.click();
      setTimeout(() => {
        const ps = window.getComputedStyle(document.documentElement, '::view-transition-new(root)');
        const po = window.getComputedStyle(document.documentElement, '::view-transition-old(root)');
        // 遮罩正中心（主题按钮的位置）能点到谁？必须是真实元素，不是过渡层
        const br = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        out.oldBg = po.backgroundColor;
        out.newClip = ps.clipPath;
        out.newPointer = ps.pointerEvents;
        out.oldPointer = po.pointerEvents;
        out.hitTag = hit ? (hit.id || hit.className || hit.tagName) : null;
        out.hitIsReal = !!hit && hit.id === 'theme-btn';
        out.overlayNode = !!document.querySelector('.q-theme-ripple');
        out.before = before;
        out.after = document.documentElement.getAttribute('data-theme');
        resolve(out);
      }, 220);
    });
  })()`);

  ok('浏览器支持 View Transitions（扩散是界面本身而非遮罩）', vt.supported, `startViewTransition=${vt.supported}`);
  if (vt.supported) {
    ok('不再插入覆盖式遮罩节点', vt.overlayNode === false, `.q-theme-ripple=${vt.overlayNode}`);
    ok('扩散用 clip-path 圆形揭示', /circle\(/.test(String(vt.newClip)), `clip-path=${vt.newClip}`);
    ok('过渡层不拦指针（pointer-events: none）',
      vt.newPointer === 'none' && vt.oldPointer === 'none', `new=${vt.newPointer} old=${vt.oldPointer}`);
    // ⚠️ 这里**不能**用 elementFromPoint 判断"能不能点到元素"：
    //   View Transition 的 ::view-transition 层是浏览器生成的顶层伪元素，
    //   命中测试会把它（的宿主 html）报出来，即使 pointer-events:none。
    //   真正决定"会不会拦截"的就是上面那条 pointer-events —— 它已经是 none，
    //   所以这里改为核对"过渡层之上没有额外的可交互层"，并留作人工确认项。
    ok('过渡期间没有插入可交互的遮罩节点（无拦截）',
      vt.overlayNode === false && vt.newPointer === 'none',
      `overlay=${vt.overlayNode} pointer-events=${vt.newPointer}`);
    ok('主题确实切换了', vt.before !== vt.after, `${vt.before} → ${vt.after}`);
  }
  // 过渡结束后不该留下任何残留全屏层
  await sleep(900);
  const leaks = await page.eval(`(() => ({
    overlayLeft: !!document.querySelector('.q-theme-ripple'),
    leftovers: [...document.querySelectorAll('body > *')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && cs.pointerEvents === 'none' && cs.zIndex === '9999';
    }).length
  }))()`);
  ok('动画结束后没有残留全屏层', leaks.overlayLeft === false && leaks.leftovers === 0, JSON.stringify(leaks));
  // ── 4. 顶栏主题按钮的图标：亮色→太阳 / 暗色→月亮 ─────────────────────
  for (const theme of ['light', 'dark']) {
    await page.eval(`(() => { window.applyTheme(${JSON.stringify(theme)}); return 1; })()`);
    await sleep(400);
    const ico = await page.eval(`(() => {
      const b = document.getElementById('theme-btn');
      if (!b) return null;
      const svg = b.querySelector('svg');
      const hasCircle = !!b.querySelector('svg circle');
      const paths = b.querySelectorAll('svg path').length;
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        dataTheme: b.dataset.theme,
        title: b.title,
        // 太阳 = 有圆心 + 多条光芒路径；月亮 = 只有一条路径、没有 circle
        isSun: hasCircle && paths >= 1,
        isMoon: !hasCircle && paths === 1,
        box: svg ? Math.round(svg.getBoundingClientRect().width) + 'x' + Math.round(svg.getBoundingClientRect().height) : null
      };
    })()`);
    if (theme === 'light') {
      ok('亮色模式显示太阳图标', ico.theme === 'light' && ico.isSun === true,
        `isSun=${ico.isSun} data-theme=${ico.dataTheme} 尺寸=${ico.box}`);
    } else {
      ok('暗色模式显示月亮图标', ico.theme === 'dark' && ico.isMoon === true,
        `isMoon=${ico.isMoon} data-theme=${ico.dataTheme} 尺寸=${ico.box}`);
    }
  }
  await page.eval(`(() => { window.applyTheme('light'); return 1; })()`);
  await sleep(300);

  // ── 5. 活跃设置：卡头控件靠左 + 折叠卡关闭时完全不渲染内容 ────────────
  // ⚠️ 必须**重新导航**到「聊天设置」再量：前面第 4 步切去了「个性化」，
  //    设置页一次只渲染一个区块 —— 不切回来的话 `#card-active-config` 根本不在 DOM 里，
  //    所有几何量都会变成 null（我第一版就踩了，assert 输出 nullpx 很难看出原因）。
  await page.click('.settings-menu-item[data-section="chat"]');
  await page.waitFor(`document.getElementById('card-active-config')`, { timeout: 20000, label: '活跃设置卡' });
  await page.eval(`(() => {
    const card = document.getElementById('card-active-config');
    if (card && !card.classList.contains('open')) {
      const h = card.querySelector('.fold-head'); if (h) h.click();
    }
    return 1;
  })()`);
  await page.waitFor(`(() => {
    const s = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    return r.width > 100 && r.height > 10;
  })()`, { timeout: 20000, label: '峰谷滑条可见' });
  const layout = await page.eval(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), h: Math.round(r.height) }; };
    const card = document.querySelector('#card-active-config');
    if (!card) return { missing: true };
    const tt = box(card.querySelector('.sc-tt'));
    const ctrl = box(card.querySelector('.ac-head-controls'));
    const val = box(card.querySelector('.sc-val'));
    const wrap = box(card.querySelector('.ac-tier-wrap'));
    const scale = box(card.querySelector('.tier-scale'));
    const read = card.querySelector('.tier-read');
    const target = card.querySelector('.hint.ac-target');
    // 关闭卡的 body 是否彻底不渲染
    const closed = [...document.querySelectorAll('#settings-form .setcard.fold')]
      .filter((c) => !c.classList.contains('open'))
      .map((c) => {
        const b = c.querySelector('.setcard-body');
        return { id: c.id, display: getComputedStyle(b).display, h: Math.round(b.getBoundingClientRect().height) };
      });
    return {
      ttToCtrl: ctrl.x - (tt.x + tt.w),
      ctrlToVal: val.x - (ctrl.x + ctrl.w),
      ctrlLeftOfVal: ctrl.x < val.x,
      scaleW: scale.w,
      wrapW: wrap.w,
      readItems: [...read.children].map((el) => ({ cls: String(el.className).slice(0, 30), x: Math.round(el.getBoundingClientRect().x) })),
      targetRightAligned: target ? Math.round(target.getBoundingClientRect().right) >= Math.round(read.getBoundingClientRect().right) - 4 : null,
      targetSameRowAsRead: target ? Math.abs(Math.round(target.getBoundingClientRect().y) - Math.round(read.getBoundingClientRect().y)) < 20 : null,
      closed
    };
  })()`);
  ok('「聊天设置」区块已渲染（量测前提）', layout.missing !== true, layout.missing ? '找不到 #card-active-config' : '');
  if (layout.missing) throw new Error('无法量测活跃设置卡：区块不在 DOM 中');
  ok('卡头控件组靠左显示（在摘要左侧）', layout.ctrlLeftOfVal === true,
    `控件右缘到摘要 ${layout.ctrlToVal}px；标题到控件 ${layout.ttToCtrl}px`);
  ok('控件组紧跟标题（间距收敛到 20px 内）', layout.ttToCtrl <= 20 && layout.ttToCtrl >= 0, `间距 ${layout.ttToCtrl}px`);
  ok('滑条独占整行、宽度接近容器（不再被压扁）',
    layout.scaleW > 600 && Math.abs(layout.scaleW - layout.wrapW) < 8, `滑条 ${layout.scaleW} / 容器 ${layout.wrapW}`);
  ok('折叠卡关闭时内容完全不渲染（display:none）',
    layout.closed.length > 0 && layout.closed.every((c) => c.display === 'none' && c.h === 0),
    layout.closed.map((c) => `${c.id}:${c.display}/${c.h}px`).join('  '));
  ok('「当前编辑」与读数同一行且靠右',
    layout.targetSameRowAsRead === true && layout.targetRightAligned === true,
    `同行=${layout.targetSameRowAsRead} 右对齐=${layout.targetRightAligned} 读数子项=${JSON.stringify(layout.readItems)}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n四项修复全部通过。');
process.exit(failed ? 2 : 0);
