/* 酒狐设置助手：只操作真实控件，不另建配置写入路径。 */
(()=>{
  let panel=null,pet=null,token=0,busy=false,overlay=null,phase='idle',history=[],thinking=false,requestEpoch=0,lastSetting=null,anchorTimer=0,anchorObserver=null;
  const eligible='input[type="checkbox"],input[type="number"],input[type="range"]';
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  function refusal(){const mood=pet?.state().mood;return mood==='angry'?'哼，我还在生气呢！现在不帮忙。':mood==='dazed'?'ご主人様…我现在有点发呆，暂时不想工作。先陪陪我吧。':'';}
  function controls(){if(!document.getElementById('settings-form')?.getBoundingClientRect().width)return [];return [...document.querySelectorAll('#settings-form '+eligible)].filter(e=>!e.disabled&&!e.readOnly&&!e.matches('[data-wine-fox-pref]')&&(e.id||e.dataset.mc));}
  function key(e){return e.id?'#'+CSS.escape(e.id):'[data-mc="'+CSS.escape(e.dataset.mc)+'"]';}
  function title(e){return e.getAttribute('aria-label')||document.querySelector('label[for="'+CSS.escape(e.id)+'"]')?.textContent.trim()||e.closest('.switch,.checkbox-row')?.textContent.trim()||e.closest('.field')?.querySelector('label')?.textContent.trim()||e.id||e.dataset.mc;}
  function status(s){panel?.querySelector('.fox-helper-status')?.replaceChildren(document.createTextNode(s));position();}
  function position(){
    if(!panel?.isConnected)return;const r=document.getElementById('wine-fox-pet')?.getBoundingClientRect();if(!r||!r.width)return;
    const w=panel.offsetWidth,h=panel.offsetHeight,vw=document.documentElement.clientWidth||innerWidth,vh=innerHeight,gap=12;
    const right=r.right+gap,left=r.left-w-gap;
    const x=right+w<=vw-8?right:left>=8?left:Math.max(8,Math.min(vw-w-8,r.left+r.width/2-w/2));
    const y=Math.max(48,Math.min(vh-h-8,r.top));
    const px=Math.round(x)+'px',py=Math.round(y)+'px';if(panel.style.left!==px)panel.style.left=px;if(panel.style.top!==py)panel.style.top=py;
  }
  function clearOverlay(){const old=overlay;overlay=null;if(old){old.source?.classList.remove('fox-helper-masked');old.classList.add('leaving');setTimeout(()=>old.remove(),220);}}
  function cancel(){clearInterval(anchorTimer);anchorTimer=0;anchorObserver?.disconnect();anchorObserver=null;token++;requestEpoch++;thinking=false;busy=false;pet?.endHelper();pet=null;panel?.remove();panel=null;clearOverlay();phase='idle';}
  function setPhase(s){phase=s;history.push(s);status({travel:'正在前往信息卡…',open:'正在打开信息卡…',control:'正在前往控件…',gesture:'正在操作…',done:'已完成设置。'}[s]||s);position();}
  function open(){cancel();if(document.documentElement.dataset.skin!=='minecraft')return false;pet=window.qqaWineFox?.helper();if(!pet||(!refusal()&&!pet.beginHelper()))return false;
    panel=document.createElement('div');panel.className='fox-helper-dialog';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','让酒狐帮忙');
    panel.innerHTML='<div class="fox-helper-heading"><strong>和酒狐说说</strong><button type="button" data-close aria-label="关闭">×</button></div><label>你想让我做什么？<textarea data-fox-message rows="3" maxlength="2000" placeholder="例如：打开背景图，把总音量调到35%"></textarea></label><p class="fox-helper-status" role="status">告诉我你的需求，我会在本地理解并帮你调整。</p><div class="fox-helper-actions"><button type="button" data-send>告诉酒狐</button><button type="button" data-cancel>取消</button></div>';
    document.body.append(panel);if(refusal())status(refusal());position();anchorObserver=new ResizeObserver(position);anchorObserver.observe(panel);anchorTimer=setInterval(position,100);
    panel.querySelector('[data-close]').onclick=cancel;panel.querySelector('[data-cancel]').onclick=cancel;panel.querySelector('[data-send]').onclick=()=>ask();
    const input=panel.querySelector('[data-fox-message]');input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});input.focus({preventScroll:true});position();return true;
  }
  function catalog(){
    const prefs=window.qqaMcTheme.read(),items=new Map();
    const add=(id,label,type,value,selector='#'+id)=>items.set(id,{id,label,type,value,...(type==='checkbox'?{}:{min:0,max:100,step:1}),selector,section:'theme'});
    add('mc-bg-on','显示Minecraft背景图','checkbox',prefs.bgOn);add('mc-sfx-on','启用互动音效总开关','checkbox',prefs.sfxOn);add('mc-motion-on','Minecraft界面动效','checkbox',window.qqaMotion.isOn());
    add('mc-sfx-volume','总音量（百分比）','range',Math.round(prefs.sfxVolume*100));add('mc-bg-opacity','背景可见度（百分比，越大越清晰）','range',Math.round(prefs.bgOpacity*100));
    for(const [k,label] of [['clickVolume','点击音音量'],['toggleVolume','开关音音量'],['sliderVolume','滑条音音量']])add('mc-'+k,label+'（百分比）','range',Math.round((prefs[k]??1)*100),'[data-mc="'+k+'"]');
    // 从现有渲染函数建立离屏目录，不切页、不绑定事件、不改变设置。
    const sections=[['desktop',renderDesktopSection],['chat',renderChatSection],['memory',renderMemorySettingsSection],['api',renderSearchSection],['allow',renderAllowSection],['advanced',renderAdvancedSection],['tools',renderToolsSection]];
    for(const [section,render] of sections){const root=document.createElement('template');root.innerHTML=render(state.config);
      for(const e of root.content.querySelectorAll(eligible)){if(!e.id||e.disabled||e.readOnly||e.closest('[hidden],[style*="display:none"],[style*="display: none"]'))continue;
        const label=root.content.querySelector('label[for="'+CSS.escape(e.id)+'"]')?.textContent.trim()||e.closest('.switch,.checkbox-row')?.textContent.trim()||e.closest('.field')?.querySelector('label')?.textContent.trim()||e.getAttribute('aria-label');if(!label)continue;
        items.set(e.id,{id:e.id,label,type:e.type,value:e.type==='checkbox'?e.checked:Number(e.value),...(e.type==='checkbox'?{}:{...(e.min!==''?{min:Number(e.min)}:{}),...(e.max!==''?{max:Number(e.max)}:{}),step:e.step==='any'?0:Number(e.step||1)}),selector:'#'+CSS.escape(e.id),section});
      }
    }
    for(const e of controls()){const id=e.id||'mc-'+e.dataset.mc;items.set(id,{id,label:title(e),type:e.type,value:e.type==='checkbox'?e.checked:Number(e.value),...(e.type==='checkbox'?{}:{...(e.min!==''?{min:Number(e.min)}:{}),...(e.max!==''?{max:Number(e.max)}:{}),step:e.step==='any'?0:Number(e.step||1)}),selector:key(e),section:window.state?.settingsSection|| (typeof state!=='undefined'?state.settingsSection:'theme')||'theme'});}
    return [...items.values()];
  }
  async function ask(message=panel?.querySelector('[data-fox-message]')?.value){
    if(!panel||busy||thinking)return false;const rejected=refusal();if(rejected){status(rejected);return false;}message=String(message||'').trim();if(!message){status('先告诉我你想做什么吧。');return false;}if(!pet.state().helperBusy&&!pet.beginHelper()){status('酒狐暂时无法帮忙。');return false;}
    thinking=true;const epoch=++requestEpoch;panel.querySelector('[data-send]').disabled=true;status('酒狐正在理解你的需求…');
    try{
      const list=catalog(),map=new Map(list.map(c=>[c.id,c]));
      const {interpretFox}=await import('/shell/fox-local-intent.mjs');if(epoch!==requestEpoch)return false;const result=interpretFox(message,list,lastSetting);lastSetting=result.last;
      // 验证整组计划后才启动动作，本地解析只能操作目录中的控件。
      const seen=new Set();for(const a of result.actions){const c=map.get(a.id);if(!c||seen.has(a.id)||a.previous!==c.value||(c.type==='checkbox'?typeof a.value!=='boolean':!Number.isFinite(a.value)||(c.min!==undefined&&a.value<c.min)||(c.max!==undefined&&a.value>c.max)||(c.step>0&&Math.abs((a.value-(c.min||0))/c.step-Math.round((a.value-(c.min||0))/c.step))>1e-6)))throw Error('酒狐没有理解清楚，请换一种说法。');seen.add(a.id);}
      const reply=String(result.reply||'').slice(0,700);status(reply);
      for(const action of result.actions){if(epoch!==requestEpoch)return false;const c=map.get(action.id);let control=document.querySelector(c.selector);
        if(!controls().includes(control)){window.openSettingsSection(c.section);for(let i=0;i<50&&epoch===requestEpoch;i++){await delay(100);control=document.querySelector(c.selector);if(controls().includes(control))break;}}
        if(epoch!==requestEpoch)return false;if(!control||!controls().includes(control)||(control.type==='checkbox'?control.checked:Number(control.value))!==c.value)throw Error('设置已发生变化，请重新告诉我你的需求。');
        if(!await run(c.selector,c.type==='checkbox'?(action.value?'on':'off'):String(action.value)))throw Error('本次操作中断，后续设置没有继续修改。');
      }
      if(epoch!==requestEpoch)return false;status(reply+(result.actions.length?' 已完成。':''));position();return true;
    }catch(error){if(epoch===requestEpoch)status(error.message);return false;}
    finally{if(epoch===requestEpoch){thinking=false;panel?.querySelector('[data-send]')?.removeAttribute('disabled');if(!busy)pet?.endHelper();}}
  }
  function destination(e){const r=e.getBoundingClientRect(),fox=document.getElementById('wine-fox-pet').getBoundingClientRect();return [r.left-fox.width*.55,r.top-fox.height*.35];}
  function leverRect(e){return e.closest('.switch')?.querySelector('.track')?.getBoundingClientRect()||e.getBoundingClientRect();}
  function floatControl(e){overlay=document.createElement('div');overlay.className='fox-helper-control';overlay.setAttribute('aria-hidden','true');
    const sw=document.createElement('label');sw.className='switch';const input=document.createElement('input');input.type='checkbox';input.checked=e.type==='checkbox'?e.checked:false;input.tabIndex=-1;const track=document.createElement('span');track.className='track';const thumb=document.createElement('span');thumb.className='thumb';track.append(thumb);sw.append(input,track);overlay.append(sw);
    if(e.type!=='checkbox'){const value=document.createElement('span');value.className='fox-helper-readout';value.textContent=e.value;overlay.append(value);}
    document.body.append(overlay);const r=leverRect(e);if(e.type==='checkbox'){overlay.classList.add('pinned');overlay.source=e.closest('.switch')?.querySelector('.track')||e;overlay.source.classList.add('fox-helper-masked');overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';}else{const point=pet.helperAlign(r.left+r.width/2,r.top+r.height/2);overlay.style.left=point[0]-48+'px';overlay.style.top=point[1]-18+'px';}
  }
  async function run(selector,value){
    if(busy||!panel||!pet)return false;if(refusal()){status(refusal());return false;}let el=document.querySelector(selector);if(!el||!controls().includes(el))return false;
    let desired;if(el.type==='checkbox')desired=value==='toggle'?!el.checked:value==='on';else{desired=Number(value);const min=el.min===''?-Infinity:Number(el.min),max=el.max===''?Infinity:Number(el.max);if(!Number.isFinite(desired)||desired<min||desired>max){status('请输入允许范围内的数值。');return false;}const step=el.step==='any'?0:Number(el.step||1);if(step>0)desired=Number(((Number.isFinite(min)?min:0)+Math.round((desired-(Number.isFinite(min)?min:0))/step)*step).toFixed(8));if(desired<min||desired>max){status('数值与步长不匹配。');return false;}}
    const current=el.type==='checkbox'?el.checked:Number(el.value);if(current===desired){status('已经是这个设置了。');return true;}
    if(!pet.state().helperBusy&&!pet.beginHelper()){status('酒狐暂时无法操作，请稍后再试。');return false;}
    busy=true;const id=++token;history=[];panel.querySelector('[data-send]').disabled=true;panel.querySelectorAll('select,input').forEach(e=>e.disabled=true);
    const live=()=>{const e=document.querySelector(selector);if(id!==token||document.hidden||document.documentElement.dataset.skin!=='minecraft'||!e||e.disabled||!document.getElementById('settings-form')?.getBoundingClientRect().width||!pet?.state().helperBusy)throw Error('操作已取消，设置没有继续修改。');return e;};
    try{
      let card=el.closest('.setcard'),head=card?.querySelector('.setcard-head');const folded=card?.classList.contains('fold')&&!card.classList.contains('open');
      if(folded&&head){head.scrollIntoView({block:'nearest',behavior:'instant'});await frame();setPhase('travel');if(!await pet.helperMove(...destination(head)))throw Error('行程中断。');live();setPhase('open');if(!await pet.helperGesture('use_mainhand',()=>{live();if(!card.classList.contains('open'))head.click();}))throw Error('打开动作中断。');await delay(260);}
      el=live();el.scrollIntoView({block:'center',behavior:'instant'});await frame();const gesture=desired>current?'lever_left_to_right':'lever_right_to_left',rect=leverRect(el),target=el.type==='checkbox'?pet.helperTarget(rect.left+rect.width/2,rect.top+14,gesture):destination(el);setPhase('control');if(!await pet.helperMove(...target,folded?'run':undefined))throw Error('行程中断。');await delay(240);el=live();floatControl(el);setPhase('gesture');let applied=false;
      const ok=await pet.helperGesture(gesture,()=>{const control=live();if(control.type==='checkbox')control.checked=desired;else control.value=String(desired);overlay?.querySelector('input')?.toggleAttribute('checked',!!desired);if(overlay)overlay.querySelector('input').checked=control.type==='checkbox'?desired:desired>current;const readout=overlay?.querySelector('.fox-helper-readout');if(readout)readout.textContent=control.value;control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));applied=true;},()=>{const control=live();if(control.type==='checkbox')return;const r=control.getBoundingClientRect();const point=pet.helperAlign(r.left+r.width/2,r.top+r.height/2);overlay.style.left=point[0]-48+'px';overlay.style.top=point[1]-18+'px';});
      if(!ok||!applied)throw Error('操作中断。');setPhase('done');return true;
    }catch(err){if(id===token)status(err.message);return false;}
    finally{if(id===token){busy=false;pet?.endHelper();clearOverlay();panel?.querySelectorAll('button,select,input').forEach(e=>e.disabled=false);if(thinking){panel.querySelector('[data-send]').disabled=true;}}}
  }
  document.addEventListener('contextmenu',e=>{if(document.documentElement.dataset.skin!=='minecraft'||document.getElementById('loading-overlay')||panel?.contains(e.target)||e.target.closest('[role="dialog"],dialog[open],.modal'))return;const petHit=window.qqaWineFox?.helper()?.helperHit(e);let target=e.target.matches(eligible)?e.target:e.target.closest('label,.switch,.checkbox-row')?.querySelector(eligible);const card=e.target.closest('#settings-form .setcard');if(!target&&card)target=[...card.querySelectorAll(eligible)].find(x=>controls().includes(x));if((petHit||target&&controls().includes(target))&&open(petHit?null:target))e.preventDefault();});
  document.addEventListener('pointerdown',e=>{if(panel&&!busy&&!thinking&&!panel.contains(e.target)&&!e.target.closest('#wine-fox-pet'))cancel();},true);
  document.addEventListener('keydown',e=>{if(panel&&e.key==='Escape'){e.preventDefault();cancel();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});window.addEventListener('qqa-skin-change',cancel);window.addEventListener('resize',position);window.addEventListener('pagehide',cancel);
  window.qqaFoxSettingsHelper={open,run,ask,cancel,state:()=>({phase,busy,thinking,history:[...history],open:!!panel})};
})();
