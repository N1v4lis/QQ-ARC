import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FoxBehavior,MOOD_ACTIONS,LOOP_ACTIONS,MOOD_HOLD_MS,visibleActions,chooseTravel,destination,TURN_RATE,THOUGHT_STEP_MS,thoughtCount,thoughtGrid} from '../app/ui/shell/fox-behavior.mjs';
for(const random of [()=>0,()=>.5,()=>.999999]){
  const fox=new FoxBehavior({now:0,random});assert(fox.idleAt>=60000&&fox.idleAt<=120000);
  assert(fox.delay()>=1000&&fox.delay()<=5000);
  assert.equal(fox.advance(fox.idleAt-1),'');assert(['angry','dazed'].includes(fox.advance(fox.idleAt)));
  assert.equal(fox.click(130000),'attention');assert.equal(fox.click(130500),'attention');assert.equal(fox.click(131000),'happy');assert.equal(fox.mood,'normal');
}
const fox=new FoxBehavior({now:0,random:()=>.5});
assert.equal(fox.click(1),'happy');assert.equal(fox.click(500),'happy');assert.equal(fox.click(1000),'angry');
assert.equal(fox.advance(10999),'');assert.equal(fox.advance(11000),'normal');
fox.click(8000);fox.click(11000);assert.equal(fox.click(14000),'happy');
assert.deepEqual(MOOD_ACTIONS.angry,['sleep','picnic','sneaking']);assert.deepEqual(MOOD_ACTIONS.dazed,['picnic','sneaking','keyboard']);
assert(LOOP_ACTIONS.has('run')&&LOOP_ACTIONS.has('walk')&&!LOOP_ACTIONS.has('death'));
for(const name of ['JaNai.ogg','Sato.ogg','Mo-Ya-Da.ogg'])assert(fs.readFileSync('Wine_Fox_PECO/'+name).equals(fs.readFileSync('app/ui/assets/wine-fox/voice/'+name)));
console.log('Fox behavior: random 60–120s inactivity / 1–5s action waits, click anger, 3-click recovery, 10s anger expiry, exact mood pools and angry audio copies passed using virtual time.');

assert.equal(MOOD_HOLD_MS,20000);assert(LOOP_ACTIONS.has('sleep'));assert.deepEqual(visibleActions(['idle','jump','gui','gui2']),['natural','idle']);
for(const [random,expected] of [[()=>0,'walk'],[()=>.4,'run'],[()=>.7,'fly'],[()=>.99,'fly']])assert.equal(chooseTravel(random),expected);
let draws=[.8,.2,.2];assert.equal(chooseTravel(()=>draws.shift()),'elytra_fly');
const angryIdle=new FoxBehavior({now:0,random:()=>0});assert.equal(angryIdle.advance(60000),'angry');assert.equal(angryIdle.until,70000);assert.equal(angryIdle.advance(70000),'normal');
for(const name of ['walk','run','fly','elytra_fly']){const d=destination([500,400],200,280,1400,900,name,()=>.8);assert(d[0]>=0&&d[0]<=1200&&d[1]>=52&&d[1]<=620);if(['walk','run'].includes(name))assert.equal(d[1],400);}

assert.equal(TURN_RATE,12);assert.equal(THOUGHT_STEP_MS,10000);assert.deepEqual([0,10000,20000,30000].map(t=>thoughtCount(t,192)),[0,1,4,9]);assert.equal(thoughtCount(3600000,192),192);for(const [w,h] of [[390,844],[1400,900],[3840,2160]]){const grid=thoughtGrid(w,h);assert(grid.capacity<=192);assert.equal(grid.capacity,grid.columns*grid.rows);}
