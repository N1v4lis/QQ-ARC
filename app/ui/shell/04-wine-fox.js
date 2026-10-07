'use strict';
// Lightweight preferences/controls stay available with the pet OFF. Three.js and
// the model are imported only when enabled; an epoch invalidates late loaders.
(function wineFoxPreferences(){
  const KEY='qqa-wine-fox';
  const DEFAULTS={enabled:true,size:280,paused:false,animation:'natural',behaviorVersion:2,expression:-1,voice:true,x:null,y:null};
  let prefs={...DEFAULTS},instance=null,controller=null,epoch=0,loading=false,error='';
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');prefs={...prefs,...saved};if(saved.behaviorVersion!==2&&saved.animation==='idle')prefs.animation='natural';}catch{/* defaults */}
  function clean(p){return {
    enabled:true,size:Math.min(400,Math.max(160,Number(p.size)||280)),paused:p.paused===true,
    behaviorVersion:2,animation:typeof p.animation==='string'&&!/^(gui2?|jump)$/i.test(p.animation)&&!(p.behaviorVersion!==2&&p.animation==='idle')?p.animation:'natural',voice:p.voice!==false,expression:[-1,0,1,2,3,4,5,6].includes(Number(p.expression))?Number(p.expression):-1,
    x:Number.isFinite(p.x)?p.x:null,y:Number.isFinite(p.y)?p.y:null
  };}
  prefs=clean(prefs);
  function save(){try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch{/* optional storage */}}
  function state(){return {preferences:{...prefs},loading,error,loaded:!!instance,...(instance?instance.state():{})};}
  function notify(){window.dispatchEvent(new CustomEvent('qqa-wine-fox-change',{detail:state()}));syncControls();}
  function syncControls(){
    const root=document.getElementById('card-wine-fox');if(!root)return;
    const status=root.querySelector('[data-wine-fox-status]');if(status)status.textContent=error|| (loading?'酒狐正在过来…':document.documentElement.dataset.skin==='minecraft'?'MC主题已开启':'仅在MC主题显示');
    for(const el of root.querySelectorAll('[data-wine-fox-pref]')){
      const key=el.dataset.wineFoxPref;
      if(key==='animation'&&instance){const names=instance.state().visibleAnimations;
        if(el.options.length!==names.length)el.replaceChildren(...names.map(name=>{const opt=document.createElement('option');opt.value=name;opt.textContent=name==='natural'?'自然':name;return opt;}));}
      if(document.activeElement!==el){if(el.type==='checkbox')el.checked=prefs[key];else el.value=String(prefs[key]);}
      if(key==='animation')el.disabled=!instance;
    }
    const summary=root.querySelector('[data-wine-fox-summary]');if(summary)summary.textContent=document.documentElement.dataset.skin==='minecraft'?'开启':'MC专属';
  }
  async function reconcile(){
    if(document.documentElement.dataset.skin!=='minecraft'){epoch++;loading=false;controller?.abort();controller=null;instance?.dispose();instance=null;error='';notify();return;}
    if(instance){instance.configure(prefs);notify();return;}
    if(loading)return;
    const ticket=++epoch;loading=true;error='';controller=new AbortController();const signal=controller.signal;notify();
    let created;
    try{
      const {createWineFox}=await import('/shell/wine-fox-runtime.mjs');
      if(ticket!==epoch||signal.aborted)return;
      created=await createWineFox(prefs,{signal,onPosition:(x,y)=>{prefs={...prefs,x,y};save();},onDisable:()=>set({enabled:false}),onError:(message)=>{error=message;notify();}});
      if(ticket!==epoch||signal.aborted){created.dispose();return;}
      instance=created;instance.configure(prefs);loading=false;notify();
    }catch(e){created?.dispose();if(ticket!==epoch)return;loading=false;if(!signal.aborted){error='酒狐暂时无法显示，请重试开启。';console.warn('[wine-fox]',e.message);}notify();}
  }
  function set(patch){prefs=clean({...prefs,...patch});save();return reconcile();}
  function home(){prefs={...prefs,x:null,y:null};save();instance?.configure(prefs);notify();}
  window.qqaWineFox={KEY,read:()=>({...prefs}),set,home,state,syncControls};
  document.addEventListener('change',e=>{const el=e.target;if(!el.matches?.('[data-wine-fox-pref]'))return;
    const key=el.dataset.wineFoxPref;set({[key]:el.type==='checkbox'?el.checked:['size','expression'].includes(key)?Number(el.value):el.value});});
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-wine-fox-home]'))home();});
  window.addEventListener('qqa-skin-change',reconcile);
  document.addEventListener('visibilitychange',()=>instance?.setSuspended(document.hidden));
  window.addEventListener('pagehide',()=>{epoch++;controller?.abort();instance?.dispose();instance=null;});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reconcile,{once:true});else reconcile();
})();
