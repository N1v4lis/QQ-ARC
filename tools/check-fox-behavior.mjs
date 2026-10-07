import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FoxBehavior,MOOD_ACTIONS,LOOP_ACTIONS} from '../app/ui/shell/fox-behavior.mjs';
for(const random of [()=>0,()=>.5,()=>.999999]){
  const fox=new FoxBehavior({now:0,random});assert(fox.idleAt>=60000&&fox.idleAt<=120000);
  assert(fox.delay()>=1000&&fox.delay()<=5000);
  assert.equal(fox.advance(fox.idleAt-1),'');assert(['angry','dazed'].includes(fox.advance(fox.idleAt)));
  assert.equal(fox.click(130000),'attention');assert.equal(fox.click(130500),'attention');assert.equal(fox.click(131000),'happy');assert.equal(fox.mood,'normal');
}
const fox=new FoxBehavior({now:0,random:()=>.5});
assert.equal(fox.click(1),'happy');assert.equal(fox.click(500),'happy');assert.equal(fox.click(1000),'angry');
assert.equal(fox.advance(6999),'');assert.equal(fox.advance(7000),'normal');
fox.click(8000);fox.click(11000);assert.equal(fox.click(14000),'happy');
assert.deepEqual(MOOD_ACTIONS.angry,['sleep','picnic','sneaking']);assert.deepEqual(MOOD_ACTIONS.dazed,['game_lost','picnic','sneaking','keyboard']);
assert(LOOP_ACTIONS.has('run')&&LOOP_ACTIONS.has('walk')&&!LOOP_ACTIONS.has('death'));
for(const name of ['JaNai.ogg','Sato.ogg','Mo-Ya-Da.ogg'])assert(fs.readFileSync('Wine_Fox_PECO/'+name).equals(fs.readFileSync('app/ui/assets/wine-fox/voice/'+name)));
console.log('Fox behavior: random 60–120s inactivity / 1–5s action waits, click anger, 3-click recovery, 6s cooldown, exact mood pools and angry audio copies passed using virtual time.');
