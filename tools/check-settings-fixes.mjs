// 验证三件事：
//  ① .field-row 里的输入框是否**等宽对齐**（用户："输入框并不对齐"）；
//  ② 「撤销本次设置」按钮出现时**是否改变页面高度**、位置是否在标题旁；
//  ③ 该按钮在 re-render 之后还会不会回来（原来有个 isConnected 的隐性 bug）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

await withPage({ url: URL_, width: 1400, height: 900 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: '界面就绪' });
  // 点真实导航（内部函数不在全局作用域，详见 probe-mc-light.mjs 的说明）
  await page.eval(`(() => { document.querySelector('#tabs .tab[data-tab="settings"]').click(); return 1; })()`);
  await page.waitFor(`!!document.querySelector('.settings-menu-item[data-section]')`, { timeout: 30000, label: '设置菜单' });
  await page.waitFor(`!!document.querySelector('#settings-form h3, #settings-form .setcard')`, { timeout: 30000, label: '设置内容' });
  await sleep(800);

  // ── ① 输入框对齐（聊天设置：指令禁言 2 个 / 主动开话题 3 个，正是用户截图那一屏）
  await page.eval(`(() => { document.querySelector('.settings-menu-item[data-section="chat"]').click(); return 1; })()`);
  await sleep(1200);
  // 展开所有折叠卡
  await page.eval(`(() => {
    let n = 0;
    document.querySelectorAll('#settings-form .setcard:not(.open) > .setcard-head').forEach((h) => { h.click(); n += 1; });
    return n;
  })()`);
  await sleep(1200);

  const rows = await page.eval(`(() => {
    const out = [];
    document.querySelectorAll('#settings-form .field-row').forEach((row, i) => {
      const inputs = [...row.querySelectorAll('input[type=text], input[type=number]')];
      if (inputs.length < 2) return;
      const g = row.getBoundingClientRect();
      out.push({
        i,
        display: getComputedStyle(row).display,
        cols: inputs.length,
        widths: inputs.map((el) => Math.round(el.getBoundingClientRect().width)),
        tops: inputs.map((el) => Math.round(el.getBoundingClientRect().top)),
        heights: inputs.map((el) => Math.round(el.getBoundingClientRect().height)),
        ids: inputs.map((el) => el.id || '(无id)'),
        rowH: Math.round(g.height)
      });
    });
    return out;
  })()`);
  console.log('── 检查 .field-row 输入框对齐');
  for (const r of rows) {
    const wOk = new Set(r.widths).size === 1;
    const tOk = Math.max(...r.tops) - Math.min(...r.tops) <= 1;
    const hOk = new Set(r.heights).size === 1;
    console.log(`  行${r.i} display=${r.display} ${r.cols} 列  宽 ${r.widths.join('/')}  顶 ${r.tops.join('/')}  高 ${r.heights.join('/')}  行高 ${r.rowH}`);
    ok(`  等宽（${r.ids.join(' / ')}）`, wOk, r.widths.join('/'));
    ok(`  顶边对齐（${r.ids.join(' / ')}）`, tOk, r.tops.join('/'));
    ok(`  高度一致（${r.ids.join(' / ')}）`, hOk, r.heights.join('/'));
  }
  if (!rows.length) console.log('  （没有多列 .field-row，无法验证）');

  // ── ② 撤销按钮：出现前后页面高度是否变化、位置是否在标题旁
  const undo = await page.eval(`(async () => {
    const form = document.getElementById('settings-form');
    const h3 = form ? form.querySelector('h3') : null;
    if (!form || !h3) return { err: '找不到 form/h3' };
    const h0 = Math.round(form.scrollHeight);
    const h3h0 = Math.round(h3.getBoundingClientRect().height);
    // 找一个真实控件触发 markDirty（改一下再改回来，避免留下配置差异）
    const probe = form.querySelector('.field-row input[type=text], .field-row input[type=number]');
    if (!probe) return { err: '找不到可改动的输入框' };
    const orig = probe.value;
    probe.value = String(orig || '') + ' ';
    probe.dispatchEvent(new Event('input', { bubbles: true }));
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const btn = form.querySelector('.settings-undo-btn');
    if (!btn) return { err: '撤销按钮没出现' };
    const b = btn.getBoundingClientRect();
    const hb = h3.getBoundingClientRect();
    const h1 = Math.round(form.scrollHeight);
    const h3h1 = Math.round(h3.getBoundingClientRect().height);
    // 还原输入值，减少副作用
    probe.value = orig;
    probe.dispatchEvent(new Event('input', { bubbles: true }));
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      before: h0, after: h1, h3Before: h3h0, h3After: h3h1,
      inH3: h3.contains(btn),
      sameRow: Math.abs(b.top + b.height / 2 - (hb.top + hb.height / 2)) < 14,
      btnH: Math.round(b.height), h3H: Math.round(hb.height),
      btnLeft: Math.round(b.left), h3Right: Math.round(hb.right)
    };
  })()`);
  console.log('\n── 检查「撤销本次设置」按钮');
  if (undo.err) { ok('撤销按钮可测', false, undo.err); }
  else {
    console.log('  ' + JSON.stringify(undo));
    ok('按钮在标题行内（位置=标题旁边）', undo.inH3 === true, String(undo.inH3));
    ok('按钮与标题同一行', undo.sameRow === true, '');
    ok('出现按钮后表单高度不变', undo.after === undo.before, `${undo.before} → ${undo.after}`);
    ok('出现按钮后标题行高度不变', undo.h3After === undo.h3Before, `${undo.h3Before} → ${undo.h3After}`);
  }

  // ── ③ 按钮在重渲染后是否还会回来（原来 isConnected 判断缺失 → 再也不会出现）
  const again = await page.eval(`(async () => {
    const form = document.getElementById('settings-form');
    const before = !!form.querySelector('.settings-undo-btn');
    // 切换区块再切回来，强制重渲染整个表单
    document.querySelector('.settings-menu-item[data-section="api"]').click();
    await new Promise((r) => setTimeout(r, 900));
    document.querySelector('.settings-menu-item[data-section="chat"]').click();
    await new Promise((r) => setTimeout(r, 900));
    const probe = document.querySelector('#settings-form .field-row input[type=text], #settings-form .field-row input[type=number], #settings-form input[type=text], #settings-form input[type=number]');
    if (!probe) return { err: '重渲染后找不到输入框', before };
    const orig = probe.value;
    probe.value = String(orig || '') + 'x';
    probe.dispatchEvent(new Event('input', { bubbles: true }));
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const after = !!document.querySelector('#settings-form .settings-undo-btn');
    probe.value = orig;
    probe.dispatchEvent(new Event('input', { bubbles: true }));
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, after };
  })()`);
  console.log('\n── 检查重渲染后按钮是否复活');
  if (again.err) ok('重渲染后按钮可测', false, again.err);
  else ok('重渲染后撤销按钮仍能再次出现', again.after === true, JSON.stringify(again));
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });

console.log(`\n结果：${pass} 项通过，${fail} 项失败。`);
process.exit(fail ? 2 : 0);
