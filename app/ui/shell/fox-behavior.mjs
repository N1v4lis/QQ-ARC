export const MOOD_ACTIONS=Object.freeze({angry:['sleep','picnic','sneaking'],dazed:['picnic','sneaking','keyboard']});
export const LOOP_ACTIONS=new Set(['idle','walk','run','fly','elytra_fly','swim','swim_stand','sneak','sneaking','climb','climbing','ladder_up','ladder_down','ladder_stillness','sit','sleep','picnic','keyboard']);
export class FoxBehavior {
  constructor({now=performance.now(),random=Math.random}={}){this.random=random;this.mood='normal';this.reason='';this.clicks=[];this.recovery=[];this.until=0;this.touch(now);}
  touch(now){this.idleAt=now+60000+this.random()*60000;}
  click(now){
    this.touch(now);
    if(this.mood!=='normal'){
      this.recovery=this.recovery.filter(t=>now-t<=5000);this.recovery.push(now);
      if(this.recovery.length<3)return 'attention';
      this.mood='normal';this.reason='';this.recovery=[];this.clicks=[];this.until=0;return 'happy';
    }
    this.clicks=this.clicks.filter(t=>now-t<=2000);this.clicks.push(now);
    if(this.clicks.length>=3){this.mood='angry';this.reason='clicks';this.until=now+10000;this.clicks=[];this.recovery=[];return 'angry';}
    return 'happy';
  }
  advance(now){
    if(this.mood==='angry'&&now>=this.until){this.mood='normal';this.reason='';this.until=0;this.touch(now);return 'normal';}
    if(this.mood==='normal'&&now>=this.idleAt){this.mood=this.random()<.5?'angry':'dazed';this.reason='idle';this.until=this.mood==='angry'?now+10000:0;this.recovery=[];return this.mood;}
    return '';
  }
  nextAt(){return this.mood==='normal'?this.idleAt:this.mood==='angry'?this.until:Infinity;}
  delay(){return 1000+this.random()*4000;}
}

export const MOOD_HOLD_MS=20000;
export const HIDDEN_ACTIONS=new Set(['gui','gui2','jump']);
export function visibleActions(names){return ['natural',...names.filter(name=>!HIDDEN_ACTIONS.has(name))];}
export function chooseTravel(random=Math.random){const groups=[['walk'],['run'],['elytra_fly','fly']];const group=groups[Math.min(2,Math.floor(random()*3))];return group[Math.min(group.length-1,Math.floor(random()*group.length))];}
export function destination(from,width,height,viewWidth,viewHeight,animation,random=Math.random){
 const maxX=Math.max(0,viewWidth-width),minY=Math.min(52,Math.max(0,viewHeight-height)),maxY=Math.max(minY,viewHeight-height);
 const x=Math.max(0,Math.min(maxX,from[0]+(random()<.5?-1:1)*(100+random()*260)));
 const flight=['fly','elytra_fly'].includes(animation);
 const y=flight?Math.max(minY,Math.min(maxY,from[1]+(random()<.5?-1:1)*(60+random()*180))):Math.max(minY,Math.min(maxY,from[1]));
 return [Math.abs(x-from[0])<40?(from[0]>maxX/2?Math.max(0,from[0]-150):Math.min(maxX,from[0]+150)):x,y];
}

export const TURN_RATE=12;
export const THOUGHT_STEP_MS=3000;
export function thoughtCount(elapsed,capacity){return Math.min(capacity,elapsed<10000?0:elapsed<15000?2:6+8*Math.floor((elapsed-15000)/THOUGHT_STEP_MS));}
export function thoughtGrid(width,height){const columns=Math.max(2,Math.ceil(Math.sqrt(512*width/Math.max(1,height)))),rows=Math.ceil(512/columns);return {columns,rows,capacity:512};}

export function nextThoughtWave(elapsed){return elapsed<10000?10000:elapsed<15000?15000:15000+(Math.floor((elapsed-15000)/THOUGHT_STEP_MS)+1)*THOUGHT_STEP_MS;}
export function scatteredThoughts(width,height,random=Math.random){
 const grid=thoughtGrid(width,height),slots=[];
 for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.columns && slots.length<grid.capacity;col++){
  const w=Math.min(width,[150,190,230][Math.floor(random()*3)]),h=Math.min(height,[34,44,54][Math.floor(random()*3)]);
  slots.push({x:Math.max(0,Math.min(width-w,(col+random())*width/grid.columns-w/2)),y:Math.max(0,Math.min(height-h,(row+random())*height/grid.rows-h/2)),width:w,height:h,angle:random()*360,plain:random()<.35,phase:random()*100});
 }
 for(let i=slots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}return slots;
}
