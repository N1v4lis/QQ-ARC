// 动效验证 + 会话详情截图。
// 动效是"看不见就算没有"的东西，必须用**真实过渡中的中间值**来证明：
//   · 侧栏折叠：宽度在 300ms 内从 236 → 60（读到中间值即证明有过渡）
//   · 视图切换：新视图有 qViewIn 动画、旧视图有 .leaving 交叉淡出
//   · 悬停/按下：有 transition-duration（不是 0s）
// 用法：node tools/check-motion.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

await withPage({ url: URL_, width: 1600, height: 900 }, async (page) => {
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时
  //    （表现为"元素等不到 / 布局像坏了"，其实是没点到）。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await sleep(2600);

  // ── 1. 侧栏折叠是"过渡"而不是瞬切 ────────────────────────────────────
  const startW = await page.eval("document.querySelector('.q-sidebar').getBoundingClientRect().width");
  await page.click('#q-side-toggle');
  await sleep(60);
  const midW = await page.eval("document.querySelector('.q-sidebar').getBoundingClientRect().width");
  await sleep(500);
  const endW = await page.eval("document.querySelector('.q-sidebar').getBoundingClientRect().width");
  ok('侧栏折叠有过渡（读到中间宽度）', midW < startW - 4 && midW > endW + 4 && endW < startW,
    `${Math.round(startW)} → ${Math.round(midW)}（60ms 时）→ ${Math.round(endW)}`);
  ok('折叠后到达 rail 宽度', endW >= 50 && endW <= 70, `${Math.round(endW)}px`);

  // 折叠态下文字应隐藏（不是挤成一团）
  const txHidden = await page.eval("getComputedStyle(document.querySelector('#tabs .tab .tab-tx')).display");
  ok('折叠态隐藏页签文字', txHidden === 'none', `display=${txHidden}`);

  // 展开回去
  await page.click('#q-side-toggle');
  await sleep(500);
  const backW = await page.eval("document.querySelector('.q-sidebar').getBoundingClientRect().width");
  ok('可展开回原宽度', Math.abs(backW - startW) < 6, `${Math.round(backW)}px`);

  // ── 2. 视图切换：新视图播入场动画，旧视图交叉淡出 ────────────────────
  // ⚠️ 先显式切到「会话」再切「存档」（2026-10-04 修）：
  //    启动默认落点已经变成「仪表盘」，所以"点 chats 时旧视图是 sessions"这个
  //    隐含假设不再成立 —— 旧视图会是 dashboard，`.leaving` 自然不在 sessions 上，
  //    断言就假失败。这里先把 sessions 切成当前视图，让用例自足、不依赖启动落点。
  await page.click('#tabs .tab[data-tab="sessions"]');
  await page.waitFor(`document.getElementById('view-sessions').classList.contains('active')`, { timeout: 15000, label: 'sessions 成为当前视图' });
  await sleep(400);   // 让上一个视图的淡出收尾，避免干扰本次观测
  await page.click('#tabs .tab[data-tab="chats"]');
  await sleep(50);
  const during = await page.eval(`(() => {
    const nv = document.getElementById('view-chats');
    const ov = document.getElementById('view-sessions');
    return {
      newAnim: getComputedStyle(nv).animationName,
      oldLeaving: ov.classList.contains('leaving'),
      oldAnim: getComputedStyle(ov).animationName
    };
  })()`);
  await sleep(600);
  const after = await page.eval(`(() => ({
    chatsActive: document.getElementById('view-chats').classList.contains('active'),
    sessionsActive: document.getElementById('view-sessions').classList.contains('active'),
    leavingCleared: !document.getElementById('view-sessions').classList.contains('leaving')
  }))()`);
  ok('新视图播放入场动画', during.newAnim === 'qViewIn', `animation-name=${during.newAnim}`);
  ok('旧视图交叉淡出（.leaving + qViewOut）', during.oldLeaving && during.oldAnim === 'qViewOut',
    `leaving=${during.oldLeaving} anim=${during.oldAnim}`);
  ok('交叉淡出结束后自动摘掉 .leaving', after.leavingCleared && after.chatsActive && !after.sessionsActive,
    JSON.stringify(after));

  // ── 3. 过渡时长不能是 0（否则等于没动效）────────────────────────────
  await page.click('#tabs .tab[data-tab="sessions"]');
  await sleep(500);
  const trans = await page.eval(`(() => {
    const el = document.querySelector('#tabs .tab');
    const cs = getComputedStyle(el);
    return { dur: cs.transitionDuration, prop: cs.transitionProperty };
  })()`);
  ok('页签有过渡时长（非 0s）', !/^0s(, 0s)*$/.test(trans.dur), `duration=${trans.dur}`);

  // ── 4. 会话详情：时间轴节点样式 + 截图 ──────────────────────────────
  // ⚠️ 两个坑都在这里踩过：
  //   ① 固定 sleep 不够 → 改成等时间轴真正渲染出来；
  //   ② **不是每个会话都有时间轴**。`tool-flow` 是"工具调用流程"，
  //      只有真正跑过工具的那次会话才有；第一项往往是"中止/无工具"的会话，
  //      点进去时间轴当然是 0 个节点 —— 原来那条断言能过纯属当时列表第一项恰好有。
  //      所以这里**遍历会话列表，找到第一个真正渲染出时间轴的**再断言，
  //      让用例不依赖"列表顺序"这种外部状态。
  await page.waitFor(`document.querySelector('#session-items .session-item')`, { timeout: 25000, label: '会话列表' });
  const found = await page.eval(`(async () => {
    const items = [...document.querySelectorAll('#session-items .session-item')];
    for (let i = 0; i < Math.min(items.length, 8); i += 1) {
      const list = document.querySelectorAll('#session-items .session-item');
      const it = list[i];
      if (!it) continue;
      it.click();
      // 等这次点击的结果落定
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await new Promise((r) => setTimeout(r, 150));
        const flow = document.querySelector('#session-detail .msg-flow');
        if (flow && flow.querySelectorAll(':scope > .tool-flow').length > 0) {
          return { ok: true, index: i, count: flow.querySelectorAll(':scope > .tool-flow').length };
        }
      }
    }
    return { ok: false, tried: Math.min(items.length, 8) };
  })()`);
  console.log(`   时间轴会话：${JSON.stringify(found)}`);
  const detail = await page.eval(`(() => {
    const flow = document.querySelector('#session-detail .msg-flow');
    const node = document.querySelector('#session-detail .msg-flow > .tool-flow');
    return {
      hasFlow: !!flow,
      nodeCount: document.querySelectorAll('#session-detail .msg-flow > .tool-flow').length,
      nodePad: node ? getComputedStyle(node).paddingLeft : null,
      headerSticky: (() => { const h = document.querySelector('#session-detail .detail-header'); return h ? getComputedStyle(h).position : null; })(),
      emptyHint: document.querySelectorAll('#session-detail .empty-hint').length
    };
  })()`);
  ok('会话详情渲染出时间轴', detail.hasFlow && detail.nodeCount > 0, `节点 ${detail.nodeCount} 个`);
  ok('时间轴节点带左侧缩进（留出竖线与圆点）', detail.nodePad === '18px', `padding-left=${detail.nodePad}`);
  ok('详情头吸顶', detail.headerSticky === 'sticky', `position=${detail.headerSticky}`);

  await page.screenshot('shots/iter6/session-detail.png');

  // ── 5. 弹窗（模型配置）动效 ─────────────────────────────────────────
  await page.click('#tabs .tab[data-tab="settings"]');
  await sleep(1500);
  await page.click('#open-model-config-btn');
  await sleep(400);
  const modal = await page.eval(`(() => {
    const ov = document.querySelector('.model-modal-overlay');
    if (!ov) return { found: false };
    const card = ov.querySelector('.model-modal') || ov.firstElementChild;
    return {
      found: true,
      overlayAnim: getComputedStyle(ov).animationName,
      cardAnim: card ? getComputedStyle(card).animationName : null,
      cardDuration: card ? getComputedStyle(card).animationDuration : null
    };
  })()`);
  ok('弹窗有入场动画', modal.found && (modal.cardAnim === 'qPopIn' || modal.overlayAnim === 'qFadeIn'),
    JSON.stringify(modal));
  await page.screenshot('shots/iter6/modal.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

const failed = results.filter((r) => !r.pass);
console.log(`\n动效验证：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 2 : 0);
