// 定点验证 MC 混合字体，不运行无关动画或完整互动回归。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withPage } from './cdp.mjs';

await withPage({ url: process.argv[2] || 'http://127.0.0.1:3210/', width: 1300, height: 850 }, async page => {
  await page.waitFor('!!window.qqaSkin && !!document.querySelector("#tabs .tab.active")', { timeout: 30000 });
  const result = await page.eval(`(async () => {
    const root = document.documentElement;
    window.qqaSkin.set('minecraft');
    root.setAttribute('data-mc-font', 'on');
    for (const [font, text] of [['Monocraft', 'OneBot 0123:()/%'], ['Minecraft AE', '：（），。'], ['Minecraft AE CJK', '酒狐仪表盘']]) {
      const faces = await document.fonts.load('15px "' + font + '"', text);
      if (!faces.length || faces.some(face => face.status !== 'loaded')) throw Error('字体未加载: ' + font);
    }
    const chain = getComputedStyle(document.body).fontFamily;
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const signature = (font, text) => {
      ctx.clearRect(0, 0, 80, 64); ctx.font = '36px ' + font;
      ctx.fillText(text, 6, 45);
      return Array.from(ctx.getImageData(0, 0, 80, 64).data).join(',');
    };
    const groups = [
      ['英文/数字', 'Monocraft', 'Ail019:/%'],
      ['中文', 'Minecraft AE CJK', '酒狐仪表盘'],
      // 比较完整旧链：原 Latin 不含的字形仍需走其原有系统回退。
      ['全角标点', chain.replace(/^Monocraft,?\\s*/, ''), '：（），。']
    ].map(([label, font, chars]) => ({label, matches: [...chars].every(ch => signature(chain, ch) === signature(label === '全角标点' ? font : '"' + font + '"', ch))}));
    root.setAttribute('data-mc-font', 'off');
    const off = getComputedStyle(document.body).fontFamily;
    window.qqaSkin.set('default');
    const normal = getComputedStyle(document.body).fontFamily;
    window.qqaSkin.set('minecraft'); root.setAttribute('data-mc-font', 'on');
    const fontRequest = performance.getEntriesByType('resource').find(item => item.name.endsWith('/Monocraft.ttf'));
    return { chain, groups, off, normal, localFont: !!fontRequest && new URL(fontRequest.name).origin === location.origin };
  })()`);
  assert.match(result.chain, /^Monocraft/);
  for (const row of result.groups) assert.equal(row.matches, true, row.label + '字形来源错误');
  assert.equal(result.localFont, true);
  assert.doesNotMatch(result.off, /Monocraft/);
  assert.doesNotMatch(result.normal, /Monocraft/);
  fs.mkdirSync('shots/final', { recursive: true });
  await page.waitFor('!document.querySelector("#loading-overlay") || getComputedStyle(document.querySelector("#loading-overlay")).display === "none"', { timeout: 15000 });
  await page.screenshot('shots/final/monocraft-theme.png');
  console.log(JSON.stringify(result, null, 2));
  console.log('✔ Monocraft 英文数字、MinecraftAE 中文、全角标点回退、本地加载和主题开关通过');
});
