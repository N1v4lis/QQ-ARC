import {scatteredThoughts} from './fox-behavior.mjs';

// One visible canvas; cached text strips avoid hundreds of DOM animations.
export function createThoughtCanvas(){
  const element=document.createElement('canvas');element.className='wine-fox-thought-cloud';element.hidden=true;element.setAttribute('aria-hidden','true');document.body.append(element);
  const ctx=element.getContext('2d'),staticLayer=document.createElement('canvas'),staticCtx=staticLayer.getContext('2d');
  let cells=[],count=0,width=0,height=0,paused=false,disposed=false,raf=0,timer=0,frames=0,drawMs=0,lastMs=0,cache=new Map(),palette='',dirty=true;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const moving=()=>!paused&&!reduced.matches&&document.documentElement.dataset.motion!=='off';
  function cancel(){cancelAnimationFrame(raf);clearTimeout(timer);raf=timer=0;}
  function colors(){const style=getComputedStyle(element);return [style.getPropertyValue('--q-fg').trim()||'#262626',style.getPropertyValue('--q-bg-1').trim()||'#fff',style.getPropertyValue('--q-line-2').trim()||'#aaa',style.getPropertyValue('--q-font').trim()||'sans-serif'];}
  function sprite(cell){const key=cell.width+':'+cell.height+':'+cell.plain;if(cache.has(key))return cache.get(key);
    const strip=document.createElement('canvas'),g=strip.getContext('2d');g.font='14px '+colors()[3];const text='ご主人様…　',period=Math.ceil(g.measureText(text).width);strip.width=period*3;strip.height=cell.height;g.font='14px '+colors()[3];g.fillStyle=colors()[0];g.textBaseline='middle';for(let i=0;i<3;i++)g.fillText(text,i*period,cell.height/2);const value={strip,period};cache.set(key,value);return value;}
  function paintCell(g,cell,now){g.save();g.translate(cell.x+cell.width/2,cell.y+cell.height/2);g.rotate(cell.angle*Math.PI/180);g.translate(-cell.width/2,-cell.height/2);
    const {strip,period}=sprite(cell);if(cell.plain){g.drawImage(strip,0,0,period,cell.height,0,0,period,cell.height);}
    else{const c=colorsCached;g.fillStyle=c[1];g.fillRect(0,0,cell.width,cell.height);g.strokeStyle=c[2];g.strokeRect(.5,.5,cell.width-1,cell.height-1);g.beginPath();g.rect(8,0,cell.width-16,cell.height);g.clip();const offset=moving()?((now/1000*22+cell.phase)%period):0;for(let x=offset-period;x<cell.width;x+=period)g.drawImage(strip,0,0,period,cell.height,x,0,period,cell.height);}
    g.restore();
  }
  let colorsCached=colors();
  function draw(now=performance.now()){
    raf=timer=0;if(disposed||!count||element.hidden)return;const start=performance.now(),nextPalette=colors().join('|');
    if(nextPalette!==palette){palette=nextPalette;colorsCached=colors();cache.clear();dirty=true;}
    if(dirty){staticCtx.clearRect(0,0,width,height);for(let i=0;i<count;i++)if(cells[i].plain)paintCell(staticCtx,cells[i],0);dirty=false;}
    ctx.clearRect(0,0,width,height);ctx.drawImage(staticLayer,0,0);for(let i=0;i<count;i++)if(!cells[i].plain)paintCell(ctx,cells[i],now);
    lastMs=performance.now()-start;drawMs+=lastMs;frames++;
    if(moving())timer=setTimeout(()=>{timer=0;raf=requestAnimationFrame(draw);},Math.max(0,1000/30-lastMs));
  }
  function sync(nextCount){
    if(!nextCount){count=0;element.hidden=true;cancel();return;}
    if(width!==innerWidth||height!==innerHeight){width=innerWidth;height=innerHeight;element.width=staticLayer.width=width;element.height=staticLayer.height=height;cells=scatteredThoughts(width,height);dirty=true;}
    if(nextCount!==count){count=nextCount;dirty=true;}element.hidden=!count;cancel();if(count)raf=requestAnimationFrame(draw);
  }
  const observer=new MutationObserver(()=>{dirty=true;if(count){cancel();raf=requestAnimationFrame(draw);}});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-skin','data-motion','class','style']});
  const onReduce=()=>{cancel();if(count)raf=requestAnimationFrame(draw);};reduced.addEventListener('change',onReduce);
  return {element,sync,clear(){count=0;cells=[];width=height=0;cache.clear();cancel();element.hidden=true;ctx.clearRect(0,0,element.width,element.height);},setPaused(value){paused=value;cancel();if(count)raf=requestAnimationFrame(draw);},dispose(){disposed=true;cancel();observer.disconnect();reduced.removeEventListener('change',onReduce);cache.clear();element.remove();staticLayer.width=staticLayer.height=element.width=element.height=0;},state:()=>({count,capacity:512,plain:cells.slice(0,count).filter(c=>c.plain).length,angleMin:count?Math.min(...cells.slice(0,count).map(c=>c.angle)):0,angleMax:count?Math.max(...cells.slice(0,count).map(c=>c.angle)):0,frames,meanDrawMs:frames?drawMs/frames:0,lastDrawMs:lastMs,paused:!moving()})};
}
