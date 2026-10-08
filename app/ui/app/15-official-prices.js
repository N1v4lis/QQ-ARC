function currentPriceEndpoint(model) {
  const api=state.config?.api||{};
  const provider=state.providers?.find(p=>p.id===($('#cfg-provider')?.value||api.provider));
  return classifyEndpoint($('#cfg-baseurl-value')?.value||api.baseUrl||provider?.baseURL,model);
}
function officialModelRecord(model) {
  const bare=String(model||'').toLowerCase().split('/').pop();
  return (state.modelPrices?.remote?.catalogue||[]).find(r=>r.id===bare)||null;
}
function openOfficialPriceCatalogue() {
  const remote=state.modelPrices?.remote||{};const vendors=new Set();let query='',page=0;const size=40;
  const overlay=modelModalShell({head:'官方模型价格',body:`<div class="official-price-browser"><div class="official-price-tools"><details class="official-vendor-dropdown" id="official-vendor"><summary id="official-vendor-caption">全部厂商</summary><div class="official-vendor-options"><label><input type="checkbox" id="official-vendor-all" checked>全部厂商</label>${MODEL_VENDORS.map(v=>`<label><input type="checkbox" value="${v.id}" data-filter-vendor>${v.name}</label>`).join('')}</div></details><input id="official-query" type="search" placeholder="查找模型名称…"><span id="official-count" class="muted"></span></div><div id="official-sources" class="official-sources"></div><div id="official-source-links" class="official-source-links"></div><div id="official-model-list"></div></div>`,foot:'<button class="btn" id="official-prev">上一页</button><button class="btn" id="official-next">下一页</button><button class="btn" id="official-close">关闭</button>'});
  function draw(){
    const list=(remote.catalogue||[]).filter(r=>(!vendors.size||vendors.has(r.vendor))&&(!query||r.id.toLowerCase().includes(query)));
    page=Math.min(page,Math.max(0,Math.ceil(list.length/size)-1));
    overlay.querySelector('#official-count').textContent=`${list.length} 个模型 · ${page+1}/${Math.max(1,Math.ceil(list.length/size))} 页`;
    overlay.querySelector('#official-vendor-caption').textContent=vendors.size?`已选 ${vendors.size} 家`:'全部厂商';
    overlay.querySelector('#official-vendor-all').checked=!vendors.size;
    overlay.querySelectorAll('[data-filter-vendor]').forEach(el=>{el.checked=vendors.has(el.value);});
    overlay.querySelector('#official-sources').innerHTML=MODEL_VENDORS.map(v=>{const s=remote.sources?.[v.id];return `<button type="button" data-vendor="${v.id}" aria-pressed="${vendors.has(v.id)}" title="筛选 ${v.name}">${modelLogoHtml({deepseek:'deepseek',glm:'glm',gemini:'gemini',mimo:'mimo',qwen:'qwen',kimi:'kimi',minimax:'minimax',anthropic:'claude',openai:'gpt',xai:'grok'}[v.id])}<span>${v.name}</span><small>${s?.ok?`${s.count} 个`:(s?.count?'缓存':'未获取')}</small></button>`;}).join('');
    overlay.querySelector('#official-source-links').innerHTML='<span class="muted">官网价格：</span>'+MODEL_VENDORS.filter(v=>!vendors.size||vendors.has(v.id)).map(v=>`<a href="${v.url}" target="_blank" rel="noopener noreferrer">${v.name} ↗</a>`).join('');
    overlay.querySelector('#official-model-list').innerHTML=list.slice(page*size,(page+1)*size).map(r=>`<details class="official-model-record"><summary><span class="model-name-with-logo">${modelLogoHtml(r.id)}${esc(r.id)}</span><span>${esc(r.currency)} · ${r.autoApply?'标准 Token 单价':'分档 / 特殊计费'}</span></summary><div class="official-record-body"><a href="${MODEL_VENDORS.find(v=>v.id===r.vendor)?.url||'#'}" target="_blank" rel="noopener">官方来源</a><span> · 更新 ${fmtTime(r.fetchedAt)}</span>${r.variants.map(v=>`<div class="official-variant"><strong>${esc(v.tier||v.period||v.unit)}</strong>${Number.isFinite(v.in)&&Number.isFinite(v.out)?`<p>输入 ${v.in} · 输出 ${v.out}${v.cached==null?'':` · 缓存命中 ${v.cached}`}（${esc(r.currency)} / 百万 Token）</p>`:''}<p>${v.raw.map(x=>esc(x)).join(' · ')}</p></div>`).join('')}</div></details>`).join('')||'<p class="muted">尚无匹配条目。点击“拉取价格表”后重试。</p>';
    overlay.querySelector('#official-prev').disabled=page===0;overlay.querySelector('#official-next').disabled=(page+1)*size>=list.length;
  }
  overlay.querySelector('#official-sources').onclick=e=>{const chip=e.target.closest('[data-vendor]');if(!chip)return;vendors.has(chip.dataset.vendor)?vendors.delete(chip.dataset.vendor):vendors.add(chip.dataset.vendor);page=0;draw();};
  overlay.querySelector('#official-vendor').onchange=e=>{if(e.target.id==='official-vendor-all')vendors.clear();else if(e.target.matches('[data-filter-vendor]'))e.target.checked?vendors.add(e.target.value):vendors.delete(e.target.value);else return;page=0;draw();};
  overlay.addEventListener('click',e=>{const dd=overlay.querySelector('#official-vendor');if(!dd.contains(e.target))dd.open=false;});
  overlay.querySelector('#official-query').oninput=e=>{query=e.target.value.trim().toLowerCase();page=0;draw();};
  overlay.querySelector('#official-prev').onclick=()=>{page--;draw();};overlay.querySelector('#official-next').onclick=()=>{page++;draw();};
  overlay.querySelector('#official-close').onclick=()=>closeModelModal(overlay);draw();
}

// All cost screens must discard their local snapshots after a pricing write.
function invalidatePriceViews() {
  if(typeof dashSnapshots!=='undefined')dashSnapshots.clear();
  if(typeof usageLastData!=='undefined')usageLastData=null;
  state.usageStats=null;
  if(state.tab==='dashboard'&&typeof loadDashboard==='function')void loadDashboard({force:true});
  if(state.tab==='usage'&&typeof loadUsageView==='function')void loadUsageView({force:true});
}
