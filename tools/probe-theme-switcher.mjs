// 验证 theme-mode 插件注入的切换器在**新 UI** 下是否真的可用。
// 背景：部署目录的 index.html 末尾有插件注入的
//   <script defer src="/theme-switcher.js"></script>
// 而工作区没有这一行 —— 也就是说 apply-ui 会冲掉它（见 probe-plugin-inject.mjs）。
// 在把这件事写进交接文档之前，必须先确认"它到底还能不能用"：
// 能用 → 它是**必须被保护**的功能；不能用 → 它是残留，可以清掉。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';

await withPage({ url: URL_, width: 1400, height: 900 }, async (page) => {
  const errors = [];
  await page.send('Runtime.enable');
  page.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    errors.push('EXCEPTION: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split('\n')[0].slice(0, 160));
  });
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push('console.error: ' + (p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
  });

  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: '界面就绪' });
  await sleep(1500);

  const st = await page.eval(`(() => {
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const pluginScripts = scripts.filter((s) => /theme-switcher|theme-elysia|theme-maid/.test(s));
    // 插件通常注入到设置弹窗里；找找有没有可识别的节点
    const hints = {
      switcherGlobal: typeof window.__themeSwitcher,
      hasThemeSelect: !!document.querySelector('select[id*="theme" i]'),
      hasThemeApply: !!document.querySelector('[id*="apply" i][id*="theme" i], [id*="theme" i] button'),
      bodyHasThemeText: /主题切换|爱莉希雅|深海女仆/.test(document.body.textContent || ''),
      styleLinks: [...document.querySelectorAll('link[href]')].map((l) => l.getAttribute('href')).filter((h) => /theme-/.test(h))
    };
    return { pluginScripts, hints, scriptCount: scripts.length };
  })()`);

  console.log('页面加载的插件脚本：' + (st.pluginScripts.length ? st.pluginScripts.join(', ') : '（无）'));
  console.log('脚本总数：' + st.scriptCount);
  console.log('线索：' + JSON.stringify(st.hints));

  // 直接 fetch 插件资产，确认它们在同源可达（404 会让切换器静默失效）
  const assets = await page.eval(`(async () => {
    const urls = ['/theme-switcher.js', '/theme-mode-status.json'];
    const out = {};
    for (const u of urls) {
      try { const r = await fetch(u, { cache: 'no-store' }); out[u] = r.status; }
      catch (e) { out[u] = 'ERR ' + e.message; }
    }
    return out;
  })()`);
  console.log('插件资产可达性：' + JSON.stringify(assets));

  console.log(errors.length ? '\n控制台错误：\n  ' + errors.slice(0, 6).join('\n  ') : '\n控制台无错误 ✔');
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
