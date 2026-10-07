// One deterministic simulation; theme affects only paint. SVG alpha masks own geometry.
export const PARTICLE_SEED = 0xA7CF0A;
export const TIMELINE = Object.freeze({seed:200,expansion:800,formation:1400,lift:1800,word:2150,end:2600});
export const THEMES = Object.freeze({
  light:{background:'#F7F9FC',particles:['#BBD8FF','#8DBAFF','#DCEBFF','#669EFF','#E8F2FF'],shadow:'rgba(65,111,197,.08)'},
  dark:{background:'#0B0F1A',particles:['#203C73','#315DA8','#4F8CFF','#7FB0FF','#D8E8FF'],shadow:'rgba(79,140,255,.15)'}
});
const DARK_COLORS={'#BBD8FF':'#7FAEFF','#DCEBFF':'#C7DCFF','#F8FBFF':'#EAF3FF','#FFFFFF':'#EAF3FF','#6F96DA':'#416FC5','#416FC5':'#1A2A44','#E8F2FF':'#C7DCFF','#8DBAFF':'#7FAEFF','#A9CCFF':'#7FAEFF'};
const clamp=x=>Math.max(0,Math.min(1,x));
const quart=x=>1-(1-clamp(x))**4;
const cubic=x=>1-(1-clamp(x))**3;
const mix=(a,b,t)=>a+(b-a)*t;
function random(seed){let n=seed>>>0;return ()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return (n>>>0)/4294967296;};}
function surface(w,h){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(w,h);const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
async function raster(svg,w,h){
  const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();
  const canvas=surface(w,h);canvas.getContext('2d').drawImage(image,0,0,w,h);return canvas;
}
function sampleMask(canvas,count,rng){
  const {width:w,height:h}=canvas,data=canvas.getContext('2d').getImageData(0,0,w,h).data,points=[];
  for(let y=1;y<h;y+=2)for(let x=1;x<w;x+=2)if(data[(y*w+x)*4+3]>128)points.push({x:x-w/2,y:y-h/2});
  if(!points.length)throw Error('Empty startup SVG mask');
  // Stratified rows cover the whole mask; one fixed seed controls every choice.
  return Array.from({length:count},(_,i)=>points[Math.min(points.length-1,Math.floor((i+rng())*points.length/count))]);
}
async function assets(){
  const urls=['arcfox-logo.svg','arcfox-wordmark.svg'];
  const [logo,word]=await Promise.all(urls.map(async name=>{const r=await fetch(new URL('../assets/startup/'+name,import.meta.url),{signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error('Startup asset '+r.status);return r.text();}));
  const wordWithoutSlash=word.replace(/<path[^>]*data-accent="slash"[^>]*\/>/,'');
  const slash=new DOMParser().parseFromString(word,'image/svg+xml').querySelector('[data-accent="slash"]');
  const coords=slash?.getAttribute('d').match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if(coords?.length!==4)throw Error('Startup slash must be a straight SVG segment');
  const accent={x0:coords[0],y0:coords[1],x1:coords[2],y1:coords[3],width:Number(slash.getAttribute('stroke-width'))};
  const darkLogo=logo.replace(/#[0-9A-F]{6}/g,c=>DARK_COLORS[c]||c);
  const darkWord=wordWithoutSlash.replaceAll('#416FC5','#DCEBFF');
  const [lightLogo,darkLogoImage,lightWord,darkWordImage]=await Promise.all([raster(logo,192,192),raster(darkLogo,192,192),raster(wordWithoutSlash,336,54),raster(darkWord,336,54)]);
  return {light:{logo:lightLogo,word:lightWord},dark:{logo:darkLogoImage,word:darkWordImage},accent};
}
export class ParticleSystem {
  constructor(images,mobile){
    const rng=random(PARTICLE_SEED),logoCount=mobile?156:224,wordCount=mobile?56:96;
    const logo=sampleMask(images.light.logo,logoCount,rng),word=sampleMask(images.light.word,wordCount,rng);
    this.particles=[...logo,...word].map((target,id)=>{
      const isWord=id>=logoCount,angle=rng()*Math.PI*2,radius=70+rng()*155;
      return {id,seed:PARTICLE_SEED,startX:(rng()-.5)*16,startY:(rng()-.5)*16,
        targetX:target.x,targetY:target.y,logoTargetX:isWord?null:target.x,logoTargetY:isWord?null:target.y,
        wordTargetX:isWord?target.x:null,wordTargetY:isWord?target.y:null,
        expansionX:Math.cos(angle)*radius,expansionY:Math.sin(angle)*radius*.8,
        velocityX:(rng()-.5)*8,velocityY:-10-rng()*18,size:2+rng()*4,
        delay:rng()*90,lifetime:isWord?2150:1400,phase:isWord?'word':'logo',tone:rng(),
        wordStartX:target.x+(rng()-.5)*90,wordStartY:70+rng()*100};
    });
    this.cells=this.makeCells(images.light.logo,this.particles.filter(p=>p.phase==='logo'),8);
    this.wordCells=this.makeCells(images.light.word,this.particles.filter(p=>p.phase==='word'),6);
  }
  makeCells(mask,particles,step){
    const data=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data,cells=[];
    for(let y=0;y<mask.height;y+=step)for(let x=0;x<mask.width;x+=step){
      let visible=false;for(let yy=y;yy<Math.min(y+step,mask.height)&&!visible;yy++)for(let xx=x;xx<Math.min(x+step,mask.width);xx++)if(data[(yy*mask.width+xx)*4+3]>128){visible=true;break;}
      if(!visible)continue;
      const cx=x+step/2-mask.width/2,cy=y+step/2-mask.height/2;
      const owner=particles.reduce((best,p)=>(p.targetX-cx)**2+(p.targetY-cy)**2<(best.targetX-cx)**2+(best.targetY-cy)**2?p:best,particles[0]);
      cells.push({x,y,w:Math.min(step,mask.width-x),h:Math.min(step,mask.height-y),owner});
    }return cells;
  }
  position(p,time){
    const t=Math.min(time,2150);
    if(p.phase==='word'){
      const letter=Math.min(5,Math.floor((p.targetX+168)/56)),start=1650+letter*35;
      const q=quart((t-start)/(500-letter*35));
      return {id:p.id,x:mix(p.wordStartX,p.targetX,q),y:mix(p.wordStartY,p.targetY,q),q,opacity:clamp((t-start)/90)*(1-clamp((q-.92)/.08))};
    }
    const a=quart((t-200-p.delay)/600),q=quart((t-800-p.delay)/(600-p.delay));
    const ex=mix(p.startX,p.expansionX,a)+Math.sin((t+p.id*17)/420)*p.velocityX*a*(1-q);
    const ey=mix(p.startY,p.expansionY,a)+p.velocityY*a*(1-q)*.2;
    const opacity=t<200?(p.id<6?clamp(t/160):0):clamp((t-200-p.delay)/140);
    return {id:p.id,x:mix(ex,p.targetX,q),y:mix(ey,p.targetY,q),q,opacity:opacity*(1-clamp((q-.90)/.10))};
  }
  snapshot(time){return this.particles.map(p=>({...this.position(p,time),size:p.size,delay:p.delay,phase:p.phase}));}
}
export class StartupAnimation {
  static async create(canvas,options={}){const images=await assets();return new StartupAnimation(canvas,images,options);}
  constructor(canvas,images,{theme=()=>document.documentElement.dataset.theme==='dark'?'dark':'light',reduced=false,onComplete=()=>{}}={}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw Error('Canvas 2D unavailable');
    this.images=images;this.theme=theme;this.reduced=reduced;this.duration=reduced?500:2600;this.onComplete=onComplete;
    this.system=new ParticleSystem(images,canvas.clientWidth<600);this.frames=0;this.time=0;this.raf=0;this.holdTimer=0;this.disposed=false;this.complete=false;
    this.resizeObserver=new ResizeObserver(()=>{this.resize();this.render(this.time);});this.resizeObserver.observe(canvas);this.resize();
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;
    const dpr=Math.min(window.devicePixelRatio||1,1.5);this.canvas.width=Math.round(rect.width*dpr);this.canvas.height=Math.round(rect.height*dpr);this.dpr=dpr;
    this.logoWidth=this.width*(this.width<600?.24:.11);this.scale=this.logoWidth/192;
    this.lift=60*Math.min(this.width/1920,this.height/1080);this.center={x:this.width*.5,y:this.height*.46};
  }
  start(){this.stop();this.complete=false;this.origin=performance.now();this.lastPaint=this.origin;this.time=0;this.render(0);this.schedule();}
  schedule(){if(this.disposed||this.complete||document.hidden)return;this.raf=requestAnimationFrame(now=>{
    this.raf=0;
    // High-refresh displays can deliver 240 callbacks/s. Paint at most ~60/s.
    if(now-this.lastPaint<1000/60-.5){this.schedule();return;}
    this.lastPaint=now;this.time=Math.min(this.duration,now-this.origin);this.render(this.time);
    if(this.time>=this.duration)this.completed();
    else if(!this.reduced&&this.time>=2150)this.hold();
    else this.schedule();
  });}
  completed(){this.complete=true;this.time=this.duration;this.onComplete();}
  hold(){this.holdTimer=setTimeout(()=>{this.holdTimer=0;this.completed();},Math.max(0,this.duration-(performance.now()-this.origin)));}
  resume(){if(this.disposed||this.complete)return;this.time=Math.min(this.duration,performance.now()-this.origin);this.render(this.time);if(this.time>=this.duration)this.completed();else if(!this.reduced&&this.time>=2150)this.hold();else this.schedule();}
  stop(){cancelAnimationFrame(this.raf);clearTimeout(this.holdTimer);this.raf=0;this.holdTimer=0;}
  dispose(){this.disposed=true;this.stop();this.resizeObserver.disconnect();this.images=null;this.system=null;this.canvas.width=1;this.canvas.height=1;}
  setReduced(value){if(!value||this.reduced)return;this.reduced=true;this.duration=500;this.origin=performance.now()-500;this.stop();this.time=500;this.render(500);this.complete=true;this.onComplete();}
  render(time){
    if(this.disposed)return;this.frames++;this.time=Math.min(time,this.duration);
    const ctx=this.ctx,theme=this.theme(),tokens=THEMES[theme],img=this.images[theme];ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.globalAlpha=1;ctx.fillStyle=tokens.background;ctx.fillRect(0,0,this.width,this.height);
    const progress=this.reduced?1:cubic((time-1500)/300),logoScale=mix(1,.94,progress),lift=this.lift*progress;
    const logoX=this.center.x-this.logoWidth*logoScale/2,logoY=this.center.y-lift-this.logoWidth*logoScale/2;
    const wordX=this.center.x-168*this.scale,wordY=this.center.y+this.logoWidth*.60;
    if(this.reduced){const q=cubic(time/500);ctx.globalAlpha=q;ctx.drawImage(img.logo,logoX,logoY+10*(1-q),this.logoWidth*.94,this.logoWidth*.94);ctx.drawImage(img.word,wordX,wordY,336*this.scale,54*this.scale);this.slash(1,wordX,wordY,theme);ctx.globalAlpha=1;return;}
    const particles=this.system.particles,positions=particles.map(p=>this.system.position(p,time));
    if(time>=1400){ctx.shadowColor=tokens.shadow;ctx.shadowBlur=theme==='dark'?12:18;ctx.shadowOffsetY=theme==='dark'?0:6;ctx.drawImage(img.logo,logoX,logoY,this.logoWidth*logoScale,this.logoWidth*logoScale);ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
    else if(time>=800)this.formation(img.logo,this.system.cells,positions,logoX,logoY,this.scale);
    if(time>=2150)ctx.drawImage(img.word,wordX,wordY,336*this.scale,54*this.scale);
    else if(time>=1650)this.formation(img.word,this.system.wordCells,positions,wordX,wordY,this.scale);
    if(time<2150)for(const p of particles){
      const pos=positions[p.id];if(pos.opacity<=0)continue;const word=p.phase==='word';
      const px=word?wordX+(pos.x+168)*this.scale:this.center.x+pos.x*this.scale;
      const py=word?wordY+(pos.y+27)*this.scale:this.center.y+pos.y*this.scale;
      const seedScale=time<200?mix(.6,1,clamp(time/200)):1;
      const size=p.size*Math.min(this.width/1920,this.height/1080)*seedScale,tone=theme==='dark'?(p.tone<.77?Math.floor(p.tone/.77*2):p.tone<.97?2:4):Math.min(4,Math.floor(p.tone*5));
      ctx.globalAlpha=pos.opacity;ctx.fillStyle=tokens.particles[tone];ctx.fillRect(px-size/2,py-size/2,size,size);
    }
    ctx.globalAlpha=1;if(time>=1990)this.slash(clamp((time-1990)/150),wordX,wordY);
  }
  formation(image,cells,positions,x,y,scale){
    const ctx=this.ctx;for(const cell of cells){const p=positions[cell.owner.id];const distance=Math.hypot(p.x-cell.owner.targetX,p.y-cell.owner.targetY);const contribution=clamp((22-distance)/16);
      if(contribution<=0)continue;ctx.globalAlpha=contribution;ctx.drawImage(image,cell.x,cell.y,cell.w,cell.h,x+cell.x*scale,y+cell.y*scale,cell.w*scale+.2,cell.h*scale+.2);
    }ctx.globalAlpha=1;
  }
  slash(q,x,y){const ctx=this.ctx,a=this.images.accent;ctx.beginPath();ctx.strokeStyle='#669EFF';ctx.lineWidth=a.width*this.scale;ctx.lineCap='round';ctx.moveTo(x+a.x0*this.scale,y+a.y0*this.scale);ctx.lineTo(x+mix(a.x0,a.x1,q)*this.scale,y+mix(a.y0,a.y1,q)*this.scale);ctx.stroke();}
  diagnostics(time=this.time){return {seed:PARTICLE_SEED,count:this.system.particles.length,time,duration:this.duration,theme:this.theme(),frames:this.frames,complete:this.complete,active:!!this.raf,geometry:this.system.snapshot(time),layout:{width:this.width,height:this.height,logoWidth:this.logoWidth,lift:this.lift},reduced:this.reduced};}
}
