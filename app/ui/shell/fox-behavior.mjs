export const MOOD_ACTIONS=Object.freeze({angry:['sleep','picnic','sneaking'],dazed:['game_lost','picnic','sneaking','keyboard']});
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
    if(this.clicks.length>=3){this.mood='angry';this.reason='clicks';this.until=now+6000;this.clicks=[];this.recovery=[];return 'angry';}
    return 'happy';
  }
  advance(now){
    if(this.mood==='angry'&&this.reason==='clicks'&&now>=this.until){this.mood='normal';this.reason='';this.until=0;this.touch(now);return 'normal';}
    if(this.mood==='normal'&&now>=this.idleAt){this.mood=this.random()<.5?'angry':'dazed';this.reason='idle';this.recovery=[];return this.mood;}
    return '';
  }
  nextAt(){return this.mood==='normal'?this.idleAt:this.reason==='clicks'?this.until:Infinity;}
  delay(){return 1000+this.random()*4000;}
}
