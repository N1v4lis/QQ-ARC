// 量出"任务栏 / 侧栏 / 内容区"三处的实际底色，以及当前跑的是哪套控制台。
// 用户问"任务栏底色为什么和主体内容一致，应该和导航栏一致" ——
// 先用真实计算值确认三者到底是什么颜色，别靠读 CSS 猜（侧栏那条规则写着 --q-bg-base，
// 但很可能被别处覆盖，或 MC 皮肤有自己的表面色）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
const rgb = (s) => s;

await withPage({ url: URL_, width: 1400, height: 900 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: '界面就绪' });

  for (const skin of ['default', 'minecraft']) {
    await page.eval(`(() => { window.qqaSkin.set(${JSON.stringify(skin)}); return 1; })()`);
    await sleep(700);
    const r = await page.eval(`(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return { bg: s.backgroundColor, color: s.color, w: Math.round(b.width), h: Math.round(b.height) };
      };
      const root = getComputedStyle(document.documentElement);
      return {
        skin: document.documentElement.dataset.skin,
        theme: document.documentElement.dataset.theme,
        tokens: {
          base: root.getPropertyValue('--q-bg-base').trim(),
          bg1: root.getPropertyValue('--q-bg-1').trim(),
          bg2: root.getPropertyValue('--q-bg-2').trim(),
          sidebar: root.getPropertyValue('--q-bg-sidebar').trim(),
          navHover: root.getPropertyValue('--q-bg-nav-hover').trim()
        },
        titlebar: cs('#topbar.q-titlebar') || cs('#topbar'),
        toolbar: cs('.q-body > .q-tb-status'),
        sidebar: cs('.q-sidebar'),
        content: cs('.q-main') || cs('#layout'),
        body: cs('body')
      };
    })()`);
    console.log(`\n═══ skin=${r.skin}  theme=${r.theme}`);
    console.log('令牌： base=' + r.tokens.base + '  bg1=' + r.tokens.bg1 + '  sidebar=' + r.tokens.sidebar);
    for (const k of ['titlebar', 'toolbar', 'sidebar', 'content', 'body']) {
      const v = r[k];
      console.log(`  ${k.padEnd(9)} ${v ? `${v.bg.padEnd(26)} ${v.w}×${v.h}` : '(未找到)'}`);
    }
    const same = (a, b) => (a && b && a.bg === b.bg);
    console.log(`  判定：任务栏 == 内容区 ? ${same(r.titlebar, r.content) ? '是' : '否'}`);
    console.log(`        任务栏 == 侧栏   ? ${same(r.titlebar, r.sidebar) ? '是' : '否'}`);
  }
  await page.eval(`(() => { window.qqaSkin.set('default'); return 1; })()`);
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });
void rgb;
