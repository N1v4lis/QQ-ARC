// 原创16格物品图标；只替换装饰节点，功能节点和默认皮肤保持。
'use strict';
(function mcIcons() {
  const R = (c,...rects) => rects.map(r=>({c,r}));
  const C = {dark:'#30251c',wood:'#a46b37',light:'#e0a55c',stone:'#767984',edge:'#363d49',silver:'#cdd5dd',paper:'#fff0c9',gold:'#ffcf53',red:'#e44b35',blue:'#66d9ed',purple:'#b677ec',green:'#72ae42'};
  const book = color => [...R(C.dark,[1,3,14,11]),...R(color,[2,2,5,10],[9,2,5,10]),...R(C.paper,[3,3,3,7],[10,3,3,7]),...R(C.wood,[7,3,2,10]),...R(C.light,[3,5,3,1],[10,7,3,1])];
  const ART = {
    gauge:[...R(C.edge,[4,1,8,14],[1,4,14,8]),...R(C.silver,[4,2,8,12],[2,4,12,8]),...R(C.stone,[4,4,8,8]),...R(C.red,[8,3,2,4],[7,6,2,3]),...R(C.paper,[6,9,2,4],[7,8,2,2])],
    chat:book(C.wood),
    archive:[...R(C.dark,[1,3,14,11]),...R(C.wood,[2,4,12,9]),...R(C.light,[2,3,12,3]),...R(C.dark,[2,7,12,1],[3,9,1,4],[12,9,1,4]),...R(C.silver,[7,6,2,5]),...R(C.stone,[8,8,1,2])],
    brain:[...R(C.edge,[6,0,4,16],[3,3,10,10],[1,6,14,4]),...R(C.purple,[6,1,4,14],[4,3,8,10],[2,6,12,4]),...R('#e8caff',[6,2,2,8],[4,5,2,4]),...R('#7745ad',[8,8,4,4],[7,12,2,2])],
    chart:[...R('#712327',[6,1,4,14],[1,6,14,4],[3,3,3,3],[10,10,3,3]),...R(C.red,[7,2,2,12],[2,7,12,2],[4,4,2,2],[10,10,2,2]),...R('#ff9b65',[7,6,3,2],[6,8,2,2])],
    spark:[...R(C.dark,[1,12,3,3],[3,10,3,3],[5,8,3,3],[4,7,6,2],[7,4,3,5],[9,2,4,5],[12,1,3,3]),...R(C.wood,[2,12,2,2],[4,10,2,2]),...R(C.gold,[5,8,4,1]),...R(C.blue,[8,5,2,3],[10,3,2,3],[12,2,2,2]),...R('#c8ffff',[9,5,1,2],[11,3,1,2])],
    plugin:[...R(C.edge,[1,6,14,8]),...R(C.silver,[2,6,12,6]),...R(C.stone,[2,12,12,2]),...R(C.wood,[4,3,2,5],[10,4,2,5]),...R(C.red,[3,2,4,3],[9,3,4,3],[6,9,4,2]),...R(C.paper,[4,2,2,1],[10,3,2,1])],
    users:[...R(C.dark,[2,1,4,6],[10,1,4,6],[2,5,12,9]),...R(C.light,[3,2,2,5],[11,2,2,5],[3,5,10,8]),...R(C.paper,[4,7,8,6],[6,5,4,3]),...R(C.blue,[4,9,2,2],[10,9,2,2]),...R(C.dark,[7,11,2,1])],
    gear:[...R(C.edge,[1,10,14,5]),...R(C.stone,[2,10,12,4]),...R(C.silver,[3,11,10,1]),...R(C.dark,[7,3,3,9],[9,1,4,3]),...R(C.wood,[8,3,2,8]),...R(C.light,[10,1,3,2])],
    cost:[...R(C.dark,[4,1,8,14],[1,4,14,8]),...R(C.gold,[4,2,8,12],[2,4,12,8]),...R('#b87525',[5,4,6,8]),...R('#fff2a5',[6,4,2,7],[8,4,2,2],[8,7,2,2])],
    search:[...R(C.dark,[3,1,7,10],[1,3,11,6],[10,10,3,3],[12,12,3,3]),...R(C.blue,[3,2,7,8],[2,4,9,4]),...R('#dafaff',[4,3,2,4],[6,3,3,1]),...R(C.wood,[11,10,2,3],[13,12,2,3])],
    sun:[...R('#ab651f',[4,4,8,8]),...R(C.gold,[5,4,6,8],[4,5,8,6],[7,0,2,3],[7,13,2,3],[0,7,3,2],[13,7,3,2],[2,2,2,2],[12,2,2,2],[2,12,2,2],[12,12,2,2]),...R('#fff6b0',[5,5,3,3])],
    moon:[...R(C.edge,[5,1,7,14],[2,4,11,8]),...R(C.silver,[5,2,6,12],[3,4,9,8]),...R('#edf8ff',[4,5,3,5]),...R(C.stone,[8,10,3,2],[7,3,2,2]),...R('#8aadd6',[12,2,2,2])],
    warning:[...R(C.dark,[7,0,2,2],[6,2,4,2],[5,4,6,2],[4,6,8,2],[3,8,10,2],[2,10,12,2],[1,12,14,3]),...R(C.gold,[7,2,2,2],[6,4,4,2],[5,6,6,2],[4,8,8,2],[3,10,10,3]),...R(C.dark,[7,5,2,4],[7,11,2,2])],
    menu:R('currentColor',[1,3,14,2],[1,7,14,2],[1,11,14,2]),
    close:R('currentColor',[2,2,3,3],[4,4,3,3],[6,6,4,4],[9,9,3,3],[11,11,3,3],[11,2,3,3],[9,4,3,3],[4,9,3,3],[2,11,3,3]),
    minus:R('currentColor',[2,11,12,2]),
    max:R('currentColor',[2,2,12,2],[2,12,12,2],[2,4,2,8],[12,4,2,8]),
    restore:R('currentColor',[5,1,10,2],[13,3,2,8],[1,5,10,2],[1,7,2,8],[3,13,8,2],[9,7,2,6]),
    arrow:R('currentColor',[4,2,2,2],[6,4,2,2],[8,6,2,4],[6,10,2,2],[4,12,2,2]),
    down:R('currentColor',[2,4,2,2],[4,6,2,2],[6,8,4,2],[10,6,2,2],[12,4,2,2]),
    refresh:R(C.green,[3,2,10,2],[2,4,2,5],[12,7,2,5],[3,12,10,2],[10,4,4,2],[10,2,2,6],[2,10,4,2],[4,8,2,6]),
    palette:[...R(C.edge,[1,2,14,12]),...R(C.wood,[2,3,12,10]),...R(C.red,[3,4,3,3]),...R(C.gold,[8,4,3,3]),...R(C.blue,[3,9,3,3]),...R(C.green,[8,9,3,3])],
    logo:[...R(C.edge,[2,2,12,13]),...R(C.green,[3,2,10,5]),...R('#acd65e',[4,3,3,2],[9,2,3,2]),...R(C.wood,[3,7,10,7]),...R(C.light,[4,8,2,2],[9,11,3,2]),...R(C.dark,[6,11,2,2],[11,8,2,2])]
  };
  ART.cache=ART.archive; ART.tokens=ART.brain; ART.runs=ART.chart; ART.account=ART.users; ART.plug=ART.plugin;
  const body = key => ART[key].map(({c,r})=>`<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="${c}"/>`).join('');
  const svg = (key,cls='')=>`<svg class="${cls}" data-mc-icon="${key}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${body(key)}</svg>`;
  const saved=new Map();
  function paint(node,key,on) {
    if(!on) {
      const original=saved.get(node);
      if(original) {node.innerHTML=original.html; if(node.tagName.toLowerCase()==='svg') for(const [name,value] of Object.entries(original.attrs)) value===null?node.removeAttribute(name):node.setAttribute(name,value);node.removeAttribute('data-mc-icon');saved.delete(node);}
      return;
    }
    if(!ART[key] || node.dataset.mcIcon===key)return;
    if(!saved.has(node))saved.set(node,{html:node.innerHTML,attrs:Object.fromEntries(['viewBox','fill','stroke','shape-rendering'].map(name=>[name,node.getAttribute(name)]))});
    if(node.tagName.toLowerCase()==='svg') {node.innerHTML=body(key);node.setAttribute('viewBox','0 0 16 16');node.setAttribute('stroke','none');node.setAttribute('shape-rendering','crispEdges');}
    else node.innerHTML=svg(key);
    node.dataset.mcIcon=key;
  }
  const emojiKey=text=>{
    for(const [pattern,key] of [[/[☀🌞]/u,'sun'],[/[🌙🌚]/u,'moon'],[/[🎨🖌]/u,'palette'],[/[🧠💎]/u,'brain'],[/[💰💵💲]/u,'cost'],[/[💬📨📖]/u,'chat'],[/[📦🗃]/u,'archive'],[/[👤👥😄🦊]/u,'users'],[/[🔄⏳⏱]/u,'refresh'],[/[🔍🔎]/u,'search'],[/[✨⚡🚀]/u,'spark'],[/[🧩🔌💉]/u,'plugin'],[/[🔑⚙🛠🔇🖥]/u,'gear'],[/[›▶]/u,'arrow']])if(pattern.test(text))return key;
    return 'gear';
  };
  const targets='#tabs .tab[data-icon] .tab-ico, .q-tb-logo svg, #theme-btn svg, #q-side-toggle svg, #q-reload-btn svg, .q-wbtn svg, .db-icon svg, .dash-beta-badge svg, .sc-ico, .t-ico, .tool-ico, .tool-icon, .chev-r, .sl-chev';
  function applyToDom(on) {
    for(const node of saved.keys())if(!node.isConnected)saved.delete(node);
    if(!on){for(const node of [...saved.keys()])paint(node,null,false);document.querySelectorAll('.mc-nav-item').forEach(node=>node.remove());return;}
    document.querySelectorAll('.q-side-foot .nav-btn').forEach(button=>{
      if(button.querySelector('.mc-nav-item'))return;
      const key=({'quote-confirm-btn':'chat','feedback-btn':'chat','skill-market-btn':'spark','plugin-market-btn':'plugin','persona-plaza-btn':'users','open-site-btn':'search'}[button.id])||'chat';
      button.insertAdjacentHTML('afterbegin',svg(ART[key]?key:'chat','mc-nav-item'));
    });
    document.querySelectorAll(targets).forEach(node=>{
      let key;const nav=node.closest('.tab[data-icon]'),box=node.closest('.dash-box');
      if(nav)key=nav.dataset.icon;
      else if(node.closest('.q-tb-logo'))key='logo';
      else if(node.closest('#theme-btn'))key=document.documentElement.dataset.theme==='dark'?'moon':'sun';
      else if(node.closest('#q-side-toggle'))key='menu';
      else if(node.closest('#q-reload-btn'))key='refresh';
      else if(node.closest('.dash-beta-badge'))key='warning';
      else if(node.closest('.q-wbtn'))key=node.classList.contains('q-ico-restore')?'restore':({minimize:'minus','toggle-maximize':'max',close:'close'}[node.closest('.q-wbtn').dataset.qwin]);
      else if(box)key=({'调用次数':'runs','估算成本':'cost','Token 总量':'tokens','缓存命中率':'cache','联网搜索':'search','会话总数':'chat','账号':'account','OneBot 连接':'plug'}[box.querySelector('.db-label')?.textContent.trim()])||'plugin';
      else if(node.matches('.sl-chev'))key='down';
      else if(node.matches('.sc-ico') && /亮度/.test(node.closest('.setcard-head')?.textContent||''))key=document.documentElement.dataset.theme==='dark'?'moon':'sun';
      else key=emojiKey(saved.get(node)?.html||node.textContent);
      paint(node,key,true);
    });
  }
  function sync(){applyToDom(document.documentElement.dataset.skin==='minecraft');}
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;sync();});}
  function start(){
    sync();
    new MutationObserver(records=>{
      // 只处理含图标的新节点，跳过自身绘制和图表，不轮询整页。
      if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&!node.closest('[data-mc-icon]')&&(node.matches(targets)||node.querySelector(targets)))))schedule();
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('qqa-skin-change',sync);window.addEventListener('qqa-theme-change',schedule);
  window.qqaMcIcons={NAV:Object.fromEntries(['gauge','chat','archive','brain','chart','spark','plugin','users','gear'].map(key=>[key,svg(key,'tab-ico')])),LOGO:svg('logo'),ART,applyToDom,sync};
})();
