'use strict';
(function startup(){
  const overlay=document.getElementById('loading-overlay'),canvas=document.getElementById('arcfox-startup');
  if(!overlay||!canvas)return;
  let animation=null,ready=false,complete=false,disposed=false,resolveDone,timedOut=false;
  let assetTimer;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const reduced=()=>media.matches||document.documentElement.dataset.motion==='off';
  function cleanup(){if(disposed)return;disposed=true;clearTimeout(assetTimer);animation?.dispose();observer.disconnect();media.removeEventListener('change',motionChange);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',cleanup);overlay.remove();resolveDone();}
  function maybeFinish(){if(ready&&complete)cleanup();}
  function finish(){ready=true;overlay.dataset.ready='true';maybeFinish();return done;}
  function visibility(){if(document.hidden)animation?.stop();else animation?.resume();}
  function motionChange(){animation?.setReduced(reduced());}
  const observer=new MutationObserver(records=>{if(records.some(r=>r.attributeName==='data-motion'))motionChange();if(records.some(r=>r.attributeName==='data-theme'))animation?.render(animation.time);});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-motion']});
  media.addEventListener('change',motionChange);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',cleanup,{once:true});
  window.qqaStartup={finish,done,state:()=>({ready,complete,disposed,...(animation&&!disposed?animation.diagnostics():{})})};
  function fallback(){clearTimeout(assetTimer);timedOut=true;overlay.dataset.animation='fallback';complete=true;maybeFinish();}
  assetTimer=setTimeout(fallback,2500);
  import('/shell/startup-animation.mjs').then(({StartupAnimation})=>StartupAnimation.create(canvas,{reduced:reduced(),onComplete:()=>{complete=true;overlay.dataset.phase='final';maybeFinish();}})).then(created=>{
    if(disposed||timedOut){created.dispose();return;}clearTimeout(assetTimer);animation=created;overlay.dataset.animation='ready';animation.start();
  }).catch(error=>{
    // Static SVG remains available when Canvas/modules/assets fail. Readiness still owns dismissal.
    console.warn('[startup] 静态启动画面:',error.message);fallback();
  });
})();
