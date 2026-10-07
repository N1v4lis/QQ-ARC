export const IMPACT_SPEED=900;
export const INJURY_IDLE_MS=15000;
export const RECOVERY_CLICKS=5;
export function releaseVelocity(samples,now){
  const recent=samples.filter(s=>now-s.at<=120);if(recent.length<2)return [0,0];const a=recent[0],b=recent.at(-1),seconds=Math.max(.016,(b.at-a.at)/1000);return [(b.x-a.x)/seconds,(b.y-a.y)/seconds].map(v=>Math.max(-2400,Math.min(2400,v)));
}
export function stepThrow(position,velocity,dt,bounds){
  const decay=Math.exp(-6*dt),step=(1-decay)/6,target=position.map((p,i)=>p+velocity[i]*step),next=target.map((p,i)=>Math.max(bounds[i][0],Math.min(bounds[i][1],p)));
  const hit=target.map((p,i)=>p<bounds[i][0]||p>bounds[i][1]);return {position:next,velocity:velocity.map((v,i)=>hit[i]?0:v*decay),impact:hit.some((h,i)=>h&&Math.abs(velocity[i])>=IMPACT_SPEED)};
}
export class FoxInjury{
  constructor(now){this.clicks=0;this.until=now+INJURY_IDLE_MS;}
  click(now){this.until=now+INJURY_IDLE_MS;return ++this.clicks>=RECOVERY_CLICKS;}
  expired(now){return now>=this.until;}
}
