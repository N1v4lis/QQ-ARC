import {StartupAnimation} from './startup-animation.mjs';
const root=document.documentElement,slider=document.getElementById('preview-time'),clock=document.getElementById('preview-clock');
const media=matchMedia('(prefers-reduced-motion: reduce)');
let animation,clockTimer;
function updateClock(){if(!animation)return;slider.value=animation.time;clock.textContent=(animation.time/1000).toFixed(2)+' s';}
function stopClock(){clearInterval(clockTimer);clockTimer=0;}
function play(){animation.start();stopClock();clockTimer=setInterval(updateClock,50);}
function theme(value){root.dataset.theme=value==='dark'?'dark':'light';for(const t of ['light','dark'])document.getElementById('preview-'+t).setAttribute('aria-pressed',String(root.dataset.theme===t));if(animation)animation.render(animation.time);}
function seek(time){animation.stop();stopClock();animation.render(Math.max(0,Math.min(animation.duration,Number(time)||0)));updateClock();}
try{
  animation=await StartupAnimation.create(document.getElementById('preview-canvas'),{reduced:media.matches,onComplete:()=>{stopClock();updateClock();}});
  slider.max=animation.duration;
  window.arcfoxPreview={play,seek,setTheme:theme,state:time=>animation.diagnostics(time),instance:animation};
  for(const t of ['light','dark'])document.getElementById('preview-'+t).addEventListener('click',()=>theme(t));
  document.getElementById('preview-replay').addEventListener('click',play);slider.addEventListener('input',()=>seek(slider.value));
  document.addEventListener('visibilitychange',()=>{if(document.hidden){animation.stop();stopClock();}else{animation.resume();if(!animation.complete){stopClock();clockTimer=setInterval(updateClock,50);}}});
  media.addEventListener('change',()=>{animation.setReduced(media.matches);slider.max=animation.duration;updateClock();});
  window.addEventListener('pagehide',()=>{stopClock();animation.dispose();},{once:true});
  theme(new URLSearchParams(location.search).get('theme'));play();
}catch(error){document.getElementById('preview-error').hidden=false;console.error('[startup-preview]',error.message);}
