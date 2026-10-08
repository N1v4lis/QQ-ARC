
// 实时总览：匿名遥测聚合。token 用 万/亿 缩写，失败或没人用时整条隐藏。
// 工具元数据与程序内 ui/app.js 的 TOOL_META 保持一致（图标/中文名/分类）。
const TOOL_META = {
  send_message:      { name: '发消息',     cat: '发言',   icon: '💬' },
  send_sticker:      { name: '发表情包',   cat: '发言',   icon: '🎴' },
  send_poke:         { name: '戳一戳',     cat: '发言',   icon: '👆' },
  get_recent_messages: { name: '翻聊天记录', cat: '查看', icon: '📜' },
  get_message_detail:  { name: '看消息详情', cat: '查看', icon: '🔍' },
  get_message_images:  { name: '看图片',     cat: '查看', icon: '🖼️' },
  get_active_members:  { name: '看活跃群友', cat: '查看', icon: '👥' },
  list_stickers:     { name: '列表情库',   cat: '表情',   icon: '📚' },
  get_sticker_image: { name: '看表情图',   cat: '表情',   icon: '🖼️' },
  collect_sticker:   { name: '收藏表情',   cat: '表情',   icon: '⭐' },
  sticker_note:      { name: '备注表情',   cat: '表情',   icon: '📝' },
  memory_append:     { name: '记一条',     cat: '记忆',   icon: '🧠' },
  memory_query:      { name: '查记忆',     cat: '记忆',   icon: '🧠' },
  memory_remove:     { name: '删记忆',     cat: '记忆',   icon: '🧹' },
  web_search:        { name: '联网搜索',   cat: '联网',   icon: '🌐' },
  web_fetch:         { name: '抓网页',     cat: '联网',   icon: '🔗' },
  report_feedback:   { name: '汇报反馈',   cat: '其他',   icon: '📣' },
  finish:            { name: '结束本次',   cat: '其他',   icon: '🏁' }
};
const TOOL_CAT_ORDER = ['发言', '查看', '表情', '记忆', '联网', '其他'];
(function () {
  function fmt(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return String(n);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  fetch('https://kondius.cn/qq-agent/api/telemetry/summary')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !d.users) return;
      document.getElementById('st-users').textContent = d.users;
      document.getElementById('st-calls').textContent = fmt(d.calls);
      document.getElementById('st-input').textContent = fmt(d.inputTokens);
      document.getElementById('st-output').textContent = fmt(d.outputTokens);
      document.getElementById('stats-band').style.display = 'flex';

      // 工具调用明细：分类分组渲染，与程序内同款
      const entries = Object.entries(d.tools || {}).filter(function (kv) { return kv[1] > 0; });
      if (!entries.length) return;
      const total = entries.reduce(function (a, kv) { return a + kv[1]; }, 0);
      const max = Math.max.apply(null, entries.map(function (kv) { return kv[1]; }));
      const byCat = new Map();
      for (const kv of entries) {
        const key = kv[0], n = kv[1];
        const meta = TOOL_META[key] || { name: key, cat: '其他', icon: '🔧' };
        if (!byCat.has(meta.cat)) byCat.set(meta.cat, []);
        byCat.get(meta.cat).push(Object.assign({ key: key, n: n }, meta));
      }
      const cats = TOOL_CAT_ORDER.filter(function (c) { return byCat.has(c); });
      for (const c of byCat.keys()) if (!cats.includes(c)) cats.push(c);
      document.getElementById('tools-detail').innerHTML = cats.map(function (cat) {
        const items = byCat.get(cat).sort(function (a, b) { return b.n - a.n; });
        const catTotal = items.reduce(function (a, x) { return a + x.n; }, 0);
        return '<div class="tb-cat">' +
          '<div class="tb-cat-head"><span>' + esc(cat) + '</span>' +
          '<span class="tb-cat-sum">' + catTotal + ' 次 · ' + (catTotal / total * 100).toFixed(0) + '%</span></div>' +
          items.map(function (it) {
            return '<div class="tb-row">' +
              '<span class="tb-icon">' + it.icon + '</span>' +
              '<span class="tb-name">' + esc(it.name) + '</span>' +
              '<span class="tb-code">' + esc(it.key) + '</span>' +
              '<span class="tb-bar"><i style="width:' + (it.n / max * 100).toFixed(1) + '%"></i></span>' +
              '<span class="tb-n">' + it.n + '</span></div>';
          }).join('') + '</div>';
      }).join('');
      document.getElementById('tools-detail').style.display = 'block';
    })
    .catch(function () {});
})();
