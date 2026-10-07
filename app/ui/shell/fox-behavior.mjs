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
export const THOUGHT_STEP_MS=10000;
export function thoughtCount(elapsed,capacity){return Math.min(capacity,Math.floor(Math.max(0,elapsed)/THOUGHT_STEP_MS)**2);}
export function thoughtGrid(width,height){const columns=Math.max(2,Math.min(16,Math.ceil(width/190))),rows=Math.max(2,Math.min(Math.floor(192/columns),Math.ceil(height/48)));return {columns,rows,capacity:columns*rows};}
