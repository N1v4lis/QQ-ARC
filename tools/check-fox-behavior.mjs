import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FoxBehavior,MOOD_ACTIONS,LOOP_ACTIONS,MOOD_HOLD_MS,visibleActions,chooseTravel,destination,TURN_RATE,THOUGHT_STEP_MS,thoughtCount,thoughtGrid,nextThoughtWave,scatteredThoughts} from '../app/ui/shell/fox-behavior.mjs';
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

assert.equal(TURN_RATE,12);assert.equal(THOUGHT_STEP_MS,3000);assert.deepEqual([9999,10000,14999,15000,17999,18000,21000].map(t=>thoughtCount(t,512)),[0,2,2,6,6,14,22]);assert.deepEqual([0,10000,15000,18000].map(nextThoughtWave),[10000,15000,18000,21000]);assert.equal(thoughtCount(3600000,512),512);for(const [w,h] of [[390,844],[1400,900],[3840,2160]]){const grid=thoughtGrid(w,h);assert(grid.capacity===512);assert(grid.columns*grid.rows>=grid.capacity);}

const positions=scatteredThoughts(1400,900);assert(positions.length===512);assert(new Set(positions.map(p=>p.angle)).size>10);for(const p of positions)assert(p.x>=0&&p.x+p.width<=1400&&p.y>=0&&p.y+p.height<=900);

const audioManifest=JSON.parse(fs.readFileSync('app/ui/assets/wine-fox/voice/manifest.json'));assert.equal(audioManifest.dazed.length,20);for(const name of audioManifest.dazed)assert(fs.readFileSync('Wine_Fox_PECO/'+name).equals(fs.readFileSync('app/ui/assets/wine-fox/voice/'+name)));console.log('20 dazed death voices: archive and runtime bytes match.');

const {releaseVelocity,stepThrow,FoxInjury,IMPACT_SPEED}=await import('../app/ui/shell/fox-throw.mjs');assert.equal(IMPACT_SPEED,900);assert.deepEqual(releaseVelocity([{x:0,y:0,at:0},{x:100,y:0,at:100}],100),[1000,0]);assert.deepEqual(releaseVelocity([{x:0,y:0,at:0},{x:100,y:0,at:100}],300),[0,0]);assert(stepThrow([990,50],[1400,0],.033,[[0,1000],[0,1000]]).impact);assert(!stepThrow([990,50],[200,0],.1,[[0,1000],[0,1000]]).impact);const hurt=new FoxInjury(0);for(let i=1;i<5;i++)assert(!hurt.click(i*1000));assert(hurt.click(5000));assert(!hurt.expired(19999));assert(hurt.expired(20000));assert(positions.some(p=>p.angle>300));assert(positions.some(p=>p.plain));assert(positions.some(p=>!p.plain));console.log('512 mixed full-angle thoughts, throw decay/collision and five-click/15s injury boundaries passed.');
