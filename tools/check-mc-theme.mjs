// 第 3~7 段验收：MC 全新图标 / 音效 / 拉杆开关 / 背景图 / 字体。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  // 清干净再进（清必须发生在页面脚本加载前，理由见 check-theme-page.mjs）
  await page.send('Page.navigate', { url: URL_.replace(/\/$/, '') + '/index.html' });
  await sleep(200);
  await page.eval(`(() => { localStorage.removeItem('qqa-skin'); localStorage.removeItem('qqa-mc'); return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动完成' });
  await sleep(800);

  // ── 默认皮肤下的基线：记录原始图标与字体，后面用来证明"确实换掉了" ──────
  const base = await page.eval(`(() => {
    const tabs = [...document.querySelectorAll('#tabs .tab[data-icon]')];
    const logo = document.querySelector('#topbar .q-tb-logo svg');
    return {
      tabCount: tabs.length,
      icons: tabs.map((t) => ({ key: t.dataset.icon, svg: (t.querySelector('.tab-ico') || {}).outerHTML || '' })),
      logo: logo ? logo.outerHTML : null,
      fontFamily: getComputedStyle(document.body).fontFamily,
      skin: document.documentElement.getAttribute('data-skin')
    };
  })()`);
  console.log(`   默认皮肤：${base.tabCount} 个导航图标`);
  ok('默认皮肤下 9 个导航图标齐全', base.tabCount === 9, `${base.tabCount}`);
  ok('默认皮肤下品牌 logo 存在', !!base.logo, '');

  // ── 切到 Minecraft：图标应全部被替换 ──────────────────────────────────
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'minecraft'`, { timeout: 10000, label: 'MC 皮肤' });
  await sleep(900);

  const mc = await page.eval(`(() => {
    const tabs = [...document.querySelectorAll('#tabs .tab[data-icon]')];
    const logo = document.querySelector('#topbar .q-tb-logo svg');
    return {
      icons: tabs.map((t) => ({ key: t.dataset.icon, svg: (t.querySelector('.tab-ico') || {}).outerHTML || '' })),
      logo: logo ? logo.outerHTML : null,
      fontFamily: getComputedStyle(document.body).fontFamily,
      apiLoaded: !!window.qqaMcIcons
    };
  })()`);
  ok('图标集运行时已加载', mc.apiLoaded === true, '');

  const changed = base.icons.filter((b, i) => b.svg !== (mc.icons[i] || {}).svg).length;
  console.log(`   MC 皮肤：${changed}/${base.tabCount} 个图标被替换`);
  ok('全部 9 个导航图标都换成了 MC 版（不是原图标）', changed === 9, `${changed}/9`);

  // "全新图标"的客观判据：MC 图标是**纯填充矩形**，默认图标是**stroke 线稿**。
  // 这条比"看起来不一样"硬：它验证的是绘制方式本身换了。
  const style = await page.eval(`(() => {
    const svgs = [...document.querySelectorAll('#tabs .tab-ico')];
    const logo = document.querySelector('#topbar .q-tb-logo svg');
    const analyze = (svg) => svg ? {
      tag: svg.tagName,
      stroke: svg.getAttribute('stroke') || (svg.style && svg.style.stroke) || null,
      hasStrokewidth: !!svg.getAttribute('stroke-width'),
      fillNone: svg.getAttribute('fill') === 'none',
      rects: svg.querySelectorAll('rect').length,
      curves: svg.querySelectorAll('circle, ellipse, path').length,
      vb: svg.getAttribute('viewBox'),
      crisp: svg.getAttribute('shape-rendering') || null
    } : null;
    return { nav: svgs.map(analyze), logo: analyze(logo) };
  })()`);
  const allNav = style.nav.filter(Boolean);
  const rectOnly = allNav.every((a) => a.rects > 0 && a.curves === 0 && !a.hasStrokewidth);
  console.log(`   图标结构：每个含矩形 ${allNav.map((a) => a.rects).join('/')}，曲线元素 ${allNav.map((a) => a.curves).join('/')}`);
  ok('MC 图标全部是"纯矩形填充、零曲线、零描边"（与默认线稿图标是两套绘制方式）',
    rectOnly === true, `矩形/曲线 = ${allNav.map((a) => `${a.rects}/${a.curves}`).join(' ')}`);
  ok('MC 图标用 crispEdges 保证像素硬边', allNav.every((a) => a.crisp === 'crispEdges'), allNav[0].crisp);
  ok('MC 图标是 16×16 像素网格（默认是 20×20）',
    allNav.every((a) => a.vb === '0 0 16 16'), allNav[0].vb);
  ok('品牌 logo 也换成了 MC 版（草方块，纯矩形）',
    !!style.logo && style.logo.rects > 0 && style.logo.curves === 0 && !style.logo.hasStrokewidth,
    style.logo ? `矩形 ${style.logo.rects} 曲线 ${style.logo.curves}` : 'null');
  ok('logo 与默认版不同', mc.logo !== base.logo, '');

  // ── 字体：打包的 MC 字体应当生效 ──────────────────────────────────────
  const font = await page.eval(`(async () => {
    // 等字体就绪（15MB，首次需要时间）；用 document.fonts 而不是 sleep
    try {
      await Promise.race([
        document.fonts.load('16px "Minecraft AE"'),
        new Promise((r) => setTimeout(r, 12000))
      ]);
    } catch (e) { /* ignore */ }
    const loaded = [...document.fonts].map((f) => ({ family: f.family, status: f.status }));
    const mcFamily = getComputedStyle(document.body).fontFamily;
    // 用 canvas 量一段中英混排的宽度：字体不同 → 宽度不同。
    // 比"读 font-family 字符串"更能证明字体**真的被应用**了。
    const measure = (fam) => {
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = '32px ' + fam;
      return Math.round(cv.measureText('OneBot 连接 SnowLuma 仪表盘').width);
    };
    return {
      declarations: loaded.filter((f) => /Minecraft/i.test(f.family)),
      bodyFamily: mcFamily,
      widthMc: measure('"Minecraft AE"'),
      widthFallback: measure('"Segoe UI", "Microsoft YaHei", sans-serif')
    };
  })()`);
  console.log(`   @font-face 声明：${JSON.stringify(font.declarations)}`);
  console.log(`   文字宽度：MC 字体 ${font.widthMc}px，系统兜底字体 ${font.widthFallback}px`);
  ok('@font-face 声明了 Minecraft AE', font.declarations.length > 0 && font.declarations.some((d) => d.status === 'loaded'),
    JSON.stringify(font.declarations));
  ok('字体真的生效（同段文字宽度与系统字体不同）',
    font.widthMc > 0 && font.widthMc !== font.widthFallback,
    `${font.widthMc} vs ${font.widthFallback}`);
  ok('body 的字体栈里含 Minecraft AE', /Minecraft AE/i.test(font.bodyFamily), font.bodyFamily);
  ok('默认皮肤下不套用 MC 字体', !/Minecraft AE/i.test(base.fontFamily), base.fontFamily);

  // ── 音效：文件可取 + 真的能播 ─────────────────────────────────────────
  const sfxNet = await page.eval(`(async () => {
    // 音频文件清单从运行时取，不再写死六个名字 ——
    // 2026-10-05 用户补了原版素材（信标/弓箭/击打×3/活塞进出/拾取），
    // 文件数从 6 涨到 15。写死清单的断言在那之后就必然失败，
    // 而且会**阻止**素材扩充（这是本轮实测踩到的）。
    const files = window.qqaMcTheme.allFiles();
    const out = [];
    for (const f of files) {
      const r = await fetch('/assets/mc/sfx/' + f);
      const ab = r.ok ? await r.arrayBuffer() : null;
      out.push({ n: f, ok: r.ok, bytes: ab ? ab.byteLength : 0, riff: ab ? new TextDecoder().decode(ab.slice(0, 4)) : null });
    }
    return out;
  })()`);
  console.log(`   音效文件（${sfxNet.length}）：${sfxNet.map((s) => s.n).join(', ')}`);
  ok('全部音效文件都能取到且是合法 WAV（RIFF 头）',
    sfxNet.length >= 10 && sfxNet.every((s) => s.ok && s.bytes > 1000 && s.riff === 'RIFF'),
    `${sfxNet.length} 个，异常：${sfxNet.filter((s) => !(s.ok && s.riff === 'RIFF')).map((s) => s.n).join(',') || '无'}`);

  const sfxPlay = await page.eval(`(async () => {
    window.qqaMcTheme.loadSfx();          // 不 await：皮肤切换时已在预载，这里只是确保在途
    // 等解码落定（用轮询而不是猜时长）
    const want = window.qqaMcTheme.allFiles().length;
    const t0 = Date.now();
    while (window.qqaMcTheme.loaded().length < want && Date.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const loaded = window.qqaMcTheme.loaded();
    const played = window.qqaMcTheme.play('menu');
    await new Promise((r) => setTimeout(r, 300));
    return { want, loadedCount: loaded.length, loaded, played, ctx: window.qqaMcTheme.ctxState() };
  })()`);
  console.log(`   已解码音效：${sfxPlay.loadedCount}/${sfxPlay.want}（AudioContext=${sfxPlay.ctx}）`);
  // ⚠️ 判据是"**累计**解码成功数 == 需要的文件数"，不是"这一次调用新解码了几个"：
  //    皮肤切换时已预载过，这里 loadSfx() 很可能一个都不新增（返回 0）。
  //    第一版把返回值当累计数断言，必假失败 —— 它测的是"是否重复解码"，
  //    而我们要验的是"所有音频都在"。
  ok('所有音效都解码成功', sfxPlay.loadedCount === sfxPlay.want,
    `${sfxPlay.loadedCount}/${sfxPlay.want}`);
  ok('音效总开关开启时播放成功', sfxPlay.played === true, `played=${sfxPlay.played}`);

  const sfxOff = await page.eval(`(async () => {
    window.qqaMcTheme.write({ sfxOn: false });
    const p1 = window.qqaMcTheme.play('menu');
    window.qqaMcTheme.write({ sfxOn: true });
    const p2 = window.qqaMcTheme.play('menu');
    return { off: p1, on: p2 };
  })()`);
  ok('总开关关闭后不再播放（需求"音效整体开关"）', sfxOff.off === false && sfxOff.on === true,
    `off→${sfxOff.off} on→${sfxOff.on}`);

  // ── 背景图：5 张可取 + 渲染进 CSS ─────────────────────────────────────
  const bgs = await page.eval(`(() => {
    const list = window.qqaMcTheme.BACKGROUNDS;
    const root = getComputedStyle(document.documentElement);
    return { count: list.length, names: list.map((b) => b.name), url: root.getPropertyValue('--mc-bg-image').trim() };
  })()`);
  ok('背景清单有 5 张（需求"默认要有 3-5 张"）', bgs.count === 5, `${bgs.count} 张：${bgs.names.join('/')}`);

  const bgNet = await page.eval(`(async () => {
    const out = [];
    for (const b of window.qqaMcTheme.BACKGROUNDS) {
      const r = await fetch(b.url);
      const ab = r.ok ? await r.arrayBuffer() : null;
      // PNG 头：89 50 4E 47
      const sig = ab ? Array.from(new Uint8Array(ab.slice(0, 4))).map((x) => x.toString(16)).join('') : null;
      // 从 IHDR 读宽高（PNG 固定布局：偏移 16 起为宽高，大端 32 位）
      let w = 0, h = 0;
      if (ab && ab.byteLength > 24) {
        const dv = new DataView(ab);
        w = dv.getUint32(16); h = dv.getUint32(20);
      }
      out.push({ name: b.name, ok: r.ok, bytes: ab ? ab.byteLength : 0, sig, w, h });
    }
    return out;
  })()`);
  console.log(`   背景图：${bgNet.map((b) => `${b.name} ${b.w}×${b.h}`).join(', ')}`);
  ok('5 张背景图都能取到且是合法 PNG', bgNet.every((b) => b.ok && b.sig === '89504e47'), bgNet.map((b) => b.sig).join(','));
  ok('背景图都是高清（≥1920×1080）', bgNet.every((b) => b.w >= 1920 && b.h >= 1080),
    bgNet.map((b) => `${b.w}x${b.h}`).join(' '));

  const bgsApplied = await page.eval(`(() => {
    const root = document.documentElement;
    const layer = getComputedStyle(document.getElementById('layout')).backgroundImage;
    return {
      attr: root.getAttribute('data-mc-bg'),
      cssVar: root.style.getPropertyValue('--mc-bg-image'),
      layoutBg: layer,
      opacityVar: root.style.getPropertyValue('--mc-bg-opacity')
    };
  })()`);
  ok('所选背景写进了 CSS 变量', /assets\/mc\/bg\//.test(bgsApplied.cssVar), bgsApplied.cssVar);
  ok('内容区真的铺上了背景图', /assets\/mc\/bg\//.test(bgsApplied.layoutBg), String(bgsApplied.layoutBg).slice(0, 90));
  ok('透明度默认 35%', bgsApplied.opacityVar === '0.35', bgsApplied.opacityVar);

  // 透明度方向：调大 → 遮罩变薄（第一版这里是反的）
  // ⚠️ 必须走 **qqaMcTheme.write()**（真正改偏好的入口），
  //    不能在测试里直接改 CSS 变量 —— 遮罩值 --mc-mask 是 applyToDocument()
  //    算好写进去的，绕过它就等于什么都没验（实测两次都读到旧值 0.65）。
  const maskCheck = await page.eval(`(() => {
    const readMask = () => getComputedStyle(document.documentElement).getPropertyValue('--mc-mask').trim();
    const mc = window.qqaMcTheme;
    mc.write({ bgOpacity: 0.2 }); const lo = readMask();
    mc.write({ bgOpacity: 0.6 }); const hi = readMask();
    mc.write({ bgOpacity: 0.35 });          // 还原默认
    return { lo, hi, restored: readMask() };
  })()`);
  const numLo = parseFloat(maskCheck.lo);
  const numHi = parseFloat(maskCheck.hi);
  console.log(`   遮罩：透明度 0.2 → --mc-mask=${maskCheck.lo}；0.6 → ${maskCheck.hi}（还原 35% → ${maskCheck.restored}）`);
  ok('透明度调大时遮罩变薄（图更清楚，方向正确）', numHi < numLo, `${numLo} → ${numHi}`);
  // 遮罩必须是**数值**而不是 calc 表达式：否则这个方向完全不可验证
  ok('--mc-mask 是可直接读取的数值（不是 calc 表达式）',
    Number.isFinite(numLo) && Number.isFinite(numHi) && !/calc/.test(maskCheck.lo),
    maskCheck.lo);

  // ── 拉杆开关：checkbox 被 CSS 改造成拉杆（DOM 不变） ──────────────────
  await page.eval(`(() => { openSettingsSection('theme'); return 1; })()`);
  await page.waitFor(`document.querySelector('#settings-form #card-mc')`, { timeout: 25000, label: 'MC 二级设置' });
  await sleep(600);
  const lever = await page.eval(`(() => {
    const cb = document.getElementById('mc-sfx-on');
    if (!cb) return null;
    const cs = getComputedStyle(cb);
    const before = getComputedStyle(cb, '::before');
    const after = getComputedStyle(cb, '::after');
    return {
      appearance: cs.appearance,
      width: cs.width, height: cs.height,
      beforeContent: before.content, afterContent: after.content,
      beforeBg: before.backgroundColor,
      hasTransform: after.transform !== 'none',
      // 拉杆应当是两个伪元素：底板 + 杆
      pseudoOk: before.content !== 'none' && after.content !== 'none'
    };
  })()`);
  // ⚠️ 读拉杆角度的三个坑，都踩过：
  //    ① 同一次 eval 里设 checked 再读 → 样式还没重算，两次同值；
  //    ② 拆两次 eval 但仍读到同一个值 → 伪元素的 transform 有 .2s 过渡，
  //       读到的是过渡中间帧（而且 `cb.style.transition='none'` 管不到伪元素）；
  //    ③ 真正可靠的做法：**禁用页面上所有过渡** + 等两帧。
  //       禁过渡要作用到伪元素，所以必须用一条全局 `*` 规则注入。
  await page.eval(`(() => {
    const st = document.createElement('style');
    st.id = '__no-transition';
    st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(st);
    return 1;
  })()`);
  const leverOff = await page.eval(`(async () => {
    const cb = document.getElementById('mc-sfx-on');
    cb.checked = false;
    // 等两帧：确保 style → layout → paint 走完
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(cb, '::after').transform;
  })()`);
  const leverOn = await page.eval(`(async () => {
    const cb = document.getElementById('mc-sfx-on');
    cb.checked = true;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(cb, '::after').transform;
  })()`);
  await page.eval(`(() => {
    const st = document.getElementById('__no-transition');
    if (st) st.remove();
    return 1;
  })()`);
  lever.offTransform = leverOff;
  lever.onTransform = leverOn;
  console.log(`   拉杆：${lever.width}×${lever.height}，底板色 ${lever.beforeBg}`);
  ok('checkbox 被改造成拉杆外观（appearance:none + 两个伪元素）',
    lever.appearance === 'none' && lever.pseudoOk === true,
    JSON.stringify({ a: lever.appearance, b: lever.beforeContent, c: lever.afterContent }));
  ok('拉杆开/关时杆身角度不同（旋转变化）',
    // ⚠️ 判据只用 leverOff/leverOn 这两个**终态**读数。
    //    不要再用第一次 eval 里快照的 hasTransform —— 那是打标当时的中间态，
    //    已经与终态无关了（本轮就这么假失败了一次）。
    lever.offTransform !== lever.onTransform
      && lever.offTransform !== 'none' && lever.onTransform !== 'none',
    `off=${String(lever.offTransform).slice(0, 38)} on=${String(lever.onTransform).slice(0, 38)}`);
  ok('拉杆保持可点尺寸（宽 ≥30px、高 ≥16px）',
    parseFloat(lever.width) >= 30 && parseFloat(lever.height) >= 16, `${lever.width}×${lever.height}`);

  // ── 滑条：MC 凹槽 + 方钮；默认不响 ───────────────────────────────────
  // ⚠️ 伪元素样式（::-webkit-slider-runnable-track）在部分 Chromium 版本里
  //    getComputedStyle 拿不到真实值，会回落到宿主元素的尺寸（实测读到 18px
  //    而非轨道自身的 6px）。所以这里**以宿主元素为准**判"被改造过"：
  //    默认滑条不会被引擎报成 appearance:none，且高度是我们设的 18px。
  const slider = await page.eval(`(() => {
    const r = document.getElementById('mc-sfx-volume');
    const cs = getComputedStyle(r);
    return {
      appearance: cs.appearance,
      height: cs.height,
      background: cs.backgroundColor,
      // 轨道/滑块样式是否被声明（用 CSSOM 直接查规则，绕开伪元素取值限制）
      hasTrackStyle: [...document.styleSheets].some((s) => {
        try { return [...s.cssRules].some((r2) => r2.selectorText && /slider-runnable-track/.test(r2.selectorText)); }
        catch { return false; }
      }),
      hasThumbStyle: [...document.styleSheets].some((s) => {
        try { return [...s.cssRules].some((r2) => r2.selectorText && /slider-thumb/.test(r2.selectorText)); }
        catch { return false; }
      })
    };
  })()`);
  ok('滑条被改造（appearance:none + 定义了 MC 风格的轨道与方块滑块）',
    slider.appearance === 'none' && slider.hasTrackStyle && slider.hasThumbStyle,
    JSON.stringify(slider));

  const sliderDefault = await page.eval(`(() => window.qqaMcTheme.read().sliderSfx)()`);
  ok('滑条音默认关闭（需求"滑条默认不开启音效"）', sliderDefault === 'off', sliderDefault);

  // 滑条音下拉里必须能选到需求列出的那几种
  const sliderOpts = await page.eval(`(() => [...document.querySelectorAll('#mc-sfx-slider option')].map((o) => o.value))()`);
  console.log(`   滑条音可选项：${sliderOpts.join(', ')}`);
  ok('滑条音可选：菜单/拾取/击打/弓箭/活塞/关',
    ['off', 'menu', 'pop', 'hit', 'bow', 'piston'].every((v) => sliderOpts.includes(v)),
    sliderOpts.join(','));

  const clickOpts = await page.eval(`(() => [...document.querySelectorAll('#mc-sfx-click option')].map((o) => o.value))()`);
  ok('点击音默认是菜单按钮', await page.eval(`(() => document.getElementById('mc-sfx-click').value)()`) === 'menu', clickOpts.join(','));

  // ── 回默认皮肤：一切复原 ─────────────────────────────────────────────
  await page.eval(`(() => { window.qqaSkin.set('default'); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'default'`, { timeout: 10000, label: '切回默认' });
  await sleep(900);
  const restored = await page.eval(`(() => {
    const tabs = [...document.querySelectorAll('#tabs .tab[data-icon]')];
    const logo = document.querySelector('#topbar .q-tb-logo svg');
    return {
      icons: tabs.map((t) => ({ key: t.dataset.icon, svg: (t.querySelector('.tab-ico') || {}).outerHTML || '' })),
      logo: logo ? logo.outerHTML : null,
      fontFamily: getComputedStyle(document.body).fontFamily,
      layoutBg: getComputedStyle(document.getElementById('layout')).backgroundImage
    };
  })()`);
  const restoredCount = restored.icons.filter((r, i) => r.svg === (base.icons[i] || {}).svg).length;
  ok('切回默认皮肤后 9 个图标全部复原', restoredCount === 9, `${restoredCount}/9`);
  ok('切回默认皮肤后 logo 复原', restored.logo === base.logo, '');
  ok('切回默认皮肤后不再套用 MC 字体', restored.fontFamily === base.fontFamily,
    `${restored.fontFamily} vs ${base.fontFamily}`);
  ok('切回默认皮肤后背景图撤掉', !/assets\/mc\/bg\//.test(String(restored.layoutBg)),
    String(restored.layoutBg).slice(0, 60));

  // 收尾：还原干净状态
  await page.eval(`(() => { localStorage.removeItem('qqa-mc'); return 1; })()`);
  await page.screenshot('shots/final/mc-theme.png');
  console.log('\n截图：shots/final/mc-theme.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\nMC 图标/音效/拉杆/背景/字体（第 3~7 段）验收通过。');
process.exit(failed ? 2 : 0);
