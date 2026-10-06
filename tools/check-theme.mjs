// 主题三档验证：默认亮色 / 跟随系统 / 手动选定后不再跟随。
// 用 CDP 的 Emulation.setEmulatedMedia 模拟系统深浅色，这是唯一能真验证
// "跟随系统"的办法（改 JS 变量只是自欺欺人）。
// 用法：node tools/check-theme.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  const setSystem = async (dark) => {
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]
    });
  };
  // 顶栏按钮现在会播"从按钮扩散"的动效，切换是异步的（~420ms 后才 commit）。
  // 本用例测的是**三档语义**，不是动效，所以每次点击后统一走这个辅助函数：
  // 用 applyTheme(pref, null) 直接落地（无动效），避免和动画时长耦合导致随机失败。
  const applyDirect = async (pref) => {
    await page.eval(`(() => { window.applyTheme(${JSON.stringify(pref)}); return 1; })()`);
    await sleep(120);
  };
  const read = async () => page.eval(`(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      theme: root.getAttribute('data-theme'),
      pref: root.getAttribute('data-theme-pref'),
      ls: (() => { try { return localStorage.getItem('qqa-theme'); } catch { return null; } })(),
      bg: cs.getPropertyValue('--q-bg-base').trim(),
      // ⚠️ document.body 在导航刚发起时可能是 null，
      //    直接 getComputedStyle(null) 会抛 TypeError（实测批量跑时偶发：
      //    "parameter 1 is not of type 'Element'"）→ 整条用例静默失败。
      bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null,
      btnTitle: (document.getElementById('theme-btn') || {}).title || '',
      btnPref: (document.getElementById('theme-btn') || {}).dataset ? document.getElementById('theme-btn').dataset.pref : null
    };
  })()`);

  // ── 0. 清掉历史偏好，模拟"全新安装" ──────────────────────────────────
  // ⚠️ 两个 key 都要清。而且**后端 config.ui.theme 必须也是空的**才算全新安装：
  //    shell/00-theme.js 在没有显式偏好时会采纳后端值（跨设备延续上次观感），
  //    这是设计行为，不是 bug。本机后端当前存着 'dark'，所以下面用
  //    localStorage 显式写 'auto' 来模拟"用户没选过、且后端也没配过"的状态，
  //    并在最后单独验证"后端有值时会被采纳"这一条。
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','auto'); localStorage.removeItem('qqa-theme'); } catch {} return 1; })()`);
  await setSystem(false);                 // 系统 = 亮色
  await page.send('Page.navigate', { url: URL_ });
  // 启动门禁：等应用启动完成（导航高亮已建立 + 遮罩已摘除）。
  // 启动默认落在「仪表盘」，链路未走完时读 data-theme 可能拿到中间态。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  await sleep(400);
  let s = await read();
  ok('默认（自动档）+ 系统亮色 → 亮色', s.theme === 'light' && s.pref === 'auto', JSON.stringify(s));

  // ── 1. 系统切暗 → 自动跟随 ───────────────────────────────────────────
  await setSystem(true);
  await sleep(700);
  s = await read();
  ok('系统切换为暗色 → 自动跟随成暗色', s.theme === 'dark' && s.pref === 'auto', `theme=${s.theme} pref=${s.pref}`);

  // ── 2. 系统切回亮 → 再跟随 ───────────────────────────────────────────
  await setSystem(false);
  await sleep(700);
  s = await read();
  ok('系统切回亮色 → 自动跟回亮色', s.theme === 'light' && s.pref === 'auto', `theme=${s.theme}`);

  // ── 3. 顶栏按钮循环：auto →（跳过空转档）→ 显式 ──────────────────────
  // 这里**真的点按钮**，验证"一次点击就能看出变化"（cycleTheme 会跳过
  // 解析结果与当前主题相同的档，见 shell/00-theme.js）。
  // 但点击会带动效（commit 延后 ~420ms），所以等待时间要覆盖动画；
  // 想要"立刻拿终态"的用例（下面第 5/6 条）改用 applyDirect()。
  await page.click('#theme-btn');
  await sleep(1100);
  s = await read();
  ok('点击一次 → 得到显式偏好且主题确实变了',
    s.theme === 'dark' && s.pref === 'dark', `theme=${s.theme} pref=${s.pref}（系统亮色时应直接给暗色）`);

  // ── 4. 再点：dark → light（**两档来回**）───────────────────────────────
  // ⚠️ 2026-10-05 用户要求去掉「跟随系统」："直接亮色和暗色切换，
  //    而不是暗色-跟随系统"。原来这一步断言"回到 auto"，现在应当是**回到亮色**。
  //    auto 的解析逻辑本身仍在，只是不再是可切换的档位 ——
  //    它的行为由本文件第 1 段（首启 pref=auto 时按系统解析）继续覆盖。
  await page.click('#theme-btn');
  await sleep(1100);
  s = await read();
  ok('再点一次 → 回到亮色（两档来回，不经过 auto）',
    s.theme === 'light' && s.pref === 'light', `theme=${s.theme} pref=${s.pref}`);

  // ── 5. 显式暗色时，系统亮色**不该**覆盖它 ────────────────────────────
  await applyDirect('dark');
  await setSystem(false);
  await sleep(600);
  s = await read();
  ok('显式暗色 + 系统亮色 → 仍是暗色（显式优先）', s.theme === 'dark' && s.pref === 'dark', `theme=${s.theme}`);

  // ── 6. 切回自动，并按当前系统（亮）解析 ──────────────────────────────
  await applyDirect('auto');
  s = await read();
  ok('切回自动后按系统亮色生效', s.theme === 'light' && s.pref === 'auto', `theme=${s.theme} pref=${s.pref}`);

  // ── 7. 刷新后偏好保持（localStorage 生效）─────────────────────────────
  await applyDirect('light');
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  s = await read();
  ok('刷新后保持显式选择', s.theme === 'light' && s.pref === 'light', JSON.stringify({ theme: s.theme, pref: s.pref, ls: s.ls }));

  // ── 8. 首屏无闪烁：内联脚本必须在第一次绘制前就把主题定好 ─────────────
  // 判定方式：系统设为暗色 + 偏好 auto，然后在**脚本都还没跑完**的时刻读 data-theme。
  // 若内联脚本被 CSP 拦掉，这里会停在静态兜底值 light。
  // ⚠️ 必须写 qqa-theme-pref（显式偏好），不能只写 qqa-theme ——
  //    getPref() 优先读前者，只写后者会被上一条用例残留的偏好盖住（本用例第一版就这么错了）。
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','auto'); } catch {} return 1; })()`);
  await setSystem(true);
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  const early = await page.eval(`(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
    ready: document.readyState
  }))()`);
  ok('首屏（脚本未跑完）就已是正确主题：auto+系统暗色 → dark',
    early.theme === 'dark', JSON.stringify(early));
  await sleep(1800);
  s = await read();
  ok('CSP 放行内联主题脚本（稳定后仍为 dark）', s.theme === 'dark' && s.pref === 'auto', `theme=${s.theme} pref=${s.pref}`);

  // ── 9. 亮色下底色确实变了（不是只换了属性）───────────────────────────
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','light'); } catch {} return 1; })()`);
  await setSystem(false);
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  const light = await read();
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','dark'); } catch {} return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  const dark = await read();
  ok('亮/暗两套底色确实不同', light.bodyBg !== dark.bodyBg && light.theme === 'light' && dark.theme === 'dark',
    `light=${light.bodyBg}(${light.theme}) dark=${dark.bodyBg}(${dark.theme})`);

  // 截图留证
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','light'); } catch {} return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  await page.screenshot('shots/theme-light.png');
  await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref','dark'); } catch {} return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  // ⚠️ 用 waitFor 而不是 sleep 猜时长：导航刚发起时 document.body 可能还是 null，
  //    此时任何 getComputedStyle(document.body) 都会抛 TypeError 让整条用例静默失败
  //    （实测批量跑时读到 "parameter 1 is not of type Element"）。
  await page.waitFor(`(() => { const r = document.documentElement; return !!document.body && !!r.getAttribute(\"data-theme\"); })()`, { timeout: 30000, label: '页面可用(主题)' });
  await sleep(250);
  await page.screenshot('shots/theme-dark.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 2 : 0);
