// 颜色格式互转的单元验证（不依赖页面渲染，直接在页面上下文里跑解析器）。
// 重点覆盖"非法输入不能被当成合法颜色"——这条曾经把随便一串乱码解析成黑色。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

await withPage({ url: URL_, width: 1200, height: 800 }, async (page) => {
  await sleep(2600);
  const r = await page.eval(`(() => {
    const F = window.qqaColorFormat;
    if (!F) return { missing: true };
    const cases = [
      // [输入, 期望 HEX（小写，无 α）]
      ['#ff00aa', '#ff00aa'],
      ['#F0A', '#ff00aa'],
      ['#ff00aa80', '#ff00aa80'],
      ['rgb(255, 0, 170)', '#ff00aa'],
      ['rgb(255 0 170)', '#ff00aa'],
      ['rgba(255,0,170,0.5)', '#ff00aa80'],
      ['hsl(320, 100%, 50%)', '#ff00aa'],
      ['hsla(320,100%,50%,0.5)', '#ff00aa80'],
      ['white', '#ffffff'],
      ['black', '#000000'],
      ['red', '#ff0000'],
      ['transparent', '#00000000']
    ];
    const good = cases.map(([inp, want]) => {
      const all = F.all(inp);
      return { inp, want, got: all ? all.hex.toLowerCase() : null, ok: !!all && all.hex.toLowerCase() === want };
    });
    // 非法输入必须解析失败
    const bad = ['not-a-color', '#12345', 'rgb(1,2)', 'hsl(1)', '', '   ', 'rgb(a,b,c)', '#gggggg', 'hsl(1,2)']
      .map((inp) => ({ inp, parsed: F.parse(inp) }));
    // 往返一致性
    const roundTrip = ['#123456', '#abcdef', 'rgb(18, 52, 86)'].map((inp) => {
      const all = F.all(inp);
      const again = all ? F.all(all.hex) : null;
      return { inp, hex1: all?.hex, hex2: again?.hex, same: all && again && all.hex === again.hex };
    });
    return { good, bad, roundTrip };
  })()`);

  if (r.missing) { console.log('✗ window.qqaColorFormat 未加载'); process.exit(1); }
  console.log('=== 合法颜色解析 ===');
  for (const g of r.good) {
    ok(`${g.inp.padEnd(22)} → ${String(g.got).padEnd(10)}（期望 ${g.want}）`, g.ok);
  }
  console.log('\n=== 非法输入必须解析失败 ===');
  for (const b of r.bad) {
    ok(`"${b.inp}" 被拒绝`, b.parsed === null, b.parsed ? `错误地解析成 ${JSON.stringify(b.parsed)}` : '');
  }
  console.log('\n=== 往返一致 ===');
  for (const t of r.roundTrip) {
    ok(`${t.inp} → ${t.hex1} → ${t.hex2}`, t.same === true);
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n颜色格式互转全部通过。');
process.exit(failed ? 2 : 0);
