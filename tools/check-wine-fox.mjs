import fs from 'node:fs';
import {withPage,sleep} from './cdp.mjs';
let fail=0;const results=[];function ok(name,value){results.push({name,pass:!!value});console.log(`${value?'✔':'✗'} ${name}`);if(!value)fail++;}
try{await withPage({url:process.argv[2]||'http://127.0.0.1:3210/',width:1400,height:900},async(page,logs)=>{
 await page.waitFor('window.qqaWineFox && !document.getElementById("loading-overlay")',{timeout:60000});await page.eval('qqaSkin.apply("default")');
 ok('默认主题无宠物',await page.eval('qqaWineFox.read().enabled && !document.getElementById("wine-fox-pet")'));
 await page.click('#tabs .tab[data-tab="settings"]');await page.waitFor('!!document.querySelector("#settings-sidebar [data-section=theme]")',{timeout:30000});await page.click('#settings-sidebar [data-section=theme]');await page.waitFor('!!document.querySelector("[data-wine-fox-pref=paused]")',{timeout:30000});
 ok('启用开关隐藏',await page.eval('!document.querySelector("[data-wine-fox-pref=enabled]")'));
 await page.eval('qqaSkin.apply("minecraft")');await page.waitFor('qqaWineFox.state().loaded',{timeout:60000});
 ok('MC自动加载，无关闭按钮',await page.eval('!!document.getElementById("wine-fox-pet") && !document.querySelector(".wine-fox-hide")'));
 ok('自然在首位，GUI和jump隐藏',await page.eval('qqaWineFox.state().animations.length===47 && qqaWineFox.state().visibleAnimations[0]==="natural" && !qqaWineFox.state().visibleAnimations.includes("jump") && document.querySelector("[data-wine-fox-pref=animation]").options[0].textContent==="自然" && !document.querySelector("[data-wine-fox-pref=animation] option[value=gui2]")'));
 await page.eval('qqaWineFox.set({paused:true,voice:true,animation:"idle",expression:-1})');await sleep(150);
 const point=()=>page.eval('(()=>{const r=document.getElementById("wine-fox-pet").getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*.6}})()');
 const mouse=(type,p)=>page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
 const key=()=>page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 let p=await point();await mouse('mousePressed',p);await mouse('mouseReleased',p);await page.waitFor('qqaWineFox.state().voicePlaying',{timeout:6000});
 ok('轻点开心语音，jump不在候选',await page.eval('qqaWineFox.state().interaction==="happy" && !qqaWineFox.state().happyAnimations.includes("jump") && !qqaWineFox.state().voiceError'));
 p=await point();await mouse('mousePressed',p);await mouse('mouseMoved',{x:p.x-60,y:p.y-30});
 ok('拖动Fly，声音保持且朝向目的地',await page.eval('qqaWineFox.state().animation==="fly" && qqaWineFox.state().voicePlaying && qqaWineFox.state().facingTarget<0'));
 await mouse('mouseReleased',{x:p.x-60,y:p.y-30});ok('松开恢复idle并保存位置',await page.eval('qqaWineFox.state().animation==="idle" && JSON.parse(localStorage.getItem(qqaWineFox.KEY)).x===qqaWineFox.state().position[0]'));
 await page.eval('document.querySelector("#wine-fox-pet canvas").focus()');await key();await key();
 ok('过量点击生气10秒、指定语音、20秒动作周期',await page.eval('(()=>{const s=qqaWineFox.state();return s.angry && s.moodUntil-performance.now()>9000 && s.moodUntil-performance.now()<=10000 && s.actionEndAt-performance.now()>19000 && ["JaNai.ogg","Sato.ogg","Mo-Ya-Da.ogg"].includes(s.voiceName)})()'));
 await key();await key();await key();ok('多点恢复开心',await page.eval('qqaWineFox.state().mood==="normal" && qqaWineFox.state().interaction==="happy"'));
 await page.eval('qqaWineFox.set({voice:false,paused:false,animation:"sleep",expression:2})');await sleep(1200);
 ok('睡觉持续循环且手动模式不切换',await page.eval('qqaWineFox.state().animation==="sleep" && qqaWineFox.state().loop===2201 && !qqaWineFox.state().natural && qqaWineFox.state().nextAutoAt===Infinity'));
 await page.eval('qqaWineFox.set({animation:"walk"})');await sleep(2200);ok('手动walk超过两轮仍保持',await page.eval('qqaWineFox.state().animation==="walk" && qqaWineFox.state().loop===2201'));
 await page.eval('qqaWineFox.set({animation:"death"})');ok('death单次',await page.eval('qqaWineFox.state().loop===2200'));await sleep(1300);ok('手动单次动作结束不随机换动作',await page.eval('qqaWineFox.state().animation==="death" && qqaWineFox.state().nextAutoAt===Infinity'));
 await page.eval('qqaWineFox.set({animation:"extra2"})');await page.waitFor('qqaWineFox.state().animation==="idle"',{timeout:4000});ok('Extra2单次结束恢复默认idle',await page.eval('qqaWineFox.read().animation==="extra2" && qqaWineFox.state().nextAutoAt===Infinity'));
 await page.eval('qqaWineFox.set({animation:"jump",paused:true})');ok('旧jump选择迁移自然且不播放jump',await page.eval('qqaWineFox.read().animation==="natural" && qqaWineFox.state().animation!=="jump"'));
 // Long-press is real input; inventory and activation use the same production buttons.
 await page.eval('qqaWineFox.set({animation:"idle",expression:-1})');await sleep(150);p=await point();await mouse('mousePressed',p);await sleep(650);await mouse('mouseReleased',p);
 ok('长按展开8个Extra圆形菜单',await page.eval('qqaWineFox.state().menuOpen && document.querySelectorAll(".wine-fox-menu [data-extra]").length===8 && qqaWineFox.state().extraAnimations.every(n=>document.querySelector(`.wine-fox-menu [data-extra="${n}"]`))'));
 await page.screenshot('shots/final/wine-fox-radial-menu.png');await page.click('.wine-fox-menu [data-extra="extra2"]');
 ok('菜单选择Extra2单次播放并关闭菜单',await page.eval('qqaWineFox.state().animation==="extra2" && qqaWineFox.state().interaction==="menu" && !qqaWineFox.state().menuOpen'));
 await page.waitFor('qqaWineFox.state().animation==="idle"',{timeout:4000});ok('菜单Extra2结束恢复原手动idle',await page.eval('!qqaWineFox.state().interaction && qqaWineFox.read().animation==="idle"'));
 // Every Extra is activated through its real menu button, without waiting out long clips.
 const extras=await page.eval('qqaWineFox.state().extraAnimations');let allExtras=true;
 for(const name of extras){await page.eval('document.querySelector("#wine-fox-pet canvas").focus()');await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F10',code:'F10',modifiers:8,windowsVirtualKeyCode:121});await page.click('.wine-fox-menu [data-extra="'+name+'"]');await sleep(60);allExtras&&=await page.eval('qqaWineFox.state().animation==='+JSON.stringify(name)+' && qqaWineFox.state().loop===2200');}
 ok('Extra0–Extra7均可通过圆形菜单触发单次动作',allExtras);
 await page.eval('qqaWineFox.set({animation:"sleep"});document.querySelector("#wine-fox-pet canvas").focus()');await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F10',code:'F10',modifiers:8,windowsVirtualKeyCode:121});await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});ok('Esc关闭菜单并恢复手动动作',await page.eval('!qqaWineFox.state().menuOpen && qqaWineFox.state().animation==="sleep"'));
 // Force branch selection, not production time: actual idle waits and travel frames run normally.
 for(const [label,values] of [['walk',[.1,.1,.1,.1,.3]],['run',[.1,.4,.1,.1,.3]],['elytra_fly',[.1,.8,.1,.1,.3,.1,.3]],['fly',[.1,.8,.8,.1,.3,.1,.3]]]){
  await page.eval(`window.__foxSavedRandom=Math.random;window.__foxDraws=${JSON.stringify(values)};Math.random=()=>window.__foxDraws.length?window.__foxDraws.shift():.1;qqaWineFox.set({animation:'idle',paused:false,x:650,y:400});qqaWineFox.set({animation:'natural'});`);
  await page.waitFor('!!qqaWineFox.state().travel',{timeout:6500});await page.eval('Math.random=window.__foxSavedRandom');const before=await page.eval('qqaWineFox.state()');await sleep(200);
  ok(`自然${label}移动并平滑朝向目的地`,await page.eval(`(()=>{const s=qqaWineFox.state();return s.animation==='${label}' && Math.abs(s.position[0]-${before.position[0]})>3 && s.facingTarget<0 && s.turnRate===12 && Math.abs(s.facingAngle)>1.2 && Math.abs(s.facingAngle)<1.58})()`));
  await page.waitFor('!qqaWineFox.state().travel',{timeout:6000});await page.eval('qqaWineFox.set({paused:true})');const angle=await page.eval('qqaWineFox.state().facingAngle');await sleep(350);
  ok(`${label}到达后自然转回主人`,await page.eval(`qqaWineFox.state().facingTarget===0 && Math.abs(qqaWineFox.state().facingAngle)<${Math.abs(angle)} && qqaWineFox.state().animation==='idle'`));
 }
 // Deadline fixture avoids waiting 60–120 seconds per mood. No production debug switch.
 async function moodFixture(random){await page.eval(`(async()=>{qqaWineFox.set({animation:'idle',paused:false,expression:-1});qqaWineFox.set({animation:'natural'});const {FoxBehavior}=await import('/shell/fox-behavior.mjs');const advance=FoxBehavior.prototype.advance,next=FoxBehavior.prototype.nextAt;window.__foxSavedRandom=Math.random;Math.random=()=>${random};FoxBehavior.prototype.nextAt=()=>performance.now()+10;FoxBehavior.prototype.advance=function(now){FoxBehavior.prototype.advance=advance;FoxBehavior.prototype.nextAt=next;this.mood='normal';this.idleAt=now;this.random=()=>.99;return advance.call(this,now)};qqaWineFox.set({size:281});})()`);await page.waitFor('qqaWineFox.state().mood==="dazed"',{timeout:3000});await page.eval('Math.random=window.__foxSavedRandom');}
 for(const [animation,random] of [['picnic',.1],['sneaking',.5],['keyboard',.99]]){await moodFixture(random);ok(`呆住${animation}连续滚动气泡，20秒周期`,await page.eval(`(()=>{const s=qqaWineFox.state(),t=document.querySelector('.wine-fox-thought-track');return s.animation==='${animation}' && s.loop===2201 && s.actionEndAt-performance.now()>19000 && t?.children.length===2 && t.textContent.includes('ご主人様…') && getComputedStyle(t).animationName==='wine-fox-thought-scroll'})()`));}
 // Shift only the synchronous behavior callback's clock; restore before the next frame.
 async function advanceThoughts(offset){await page.eval(`(async()=>{const {FoxBehavior}=await import('/shell/fox-behavior.mjs'),advance=FoxBehavior.prototype.advance,next=FoxBehavior.prototype.nextAt;FoxBehavior.prototype.nextAt=()=>performance.now()+10;FoxBehavior.prototype.advance=function(now){FoxBehavior.prototype.advance=advance;FoxBehavior.prototype.nextAt=next;const result=advance.call(this,now),saved=performance.now.bind(performance);performance.now=()=>saved()+${offset};setTimeout(()=>{delete performance.now},0);return result};qqaWineFox.set({size:282});})()`);}
 await advanceThoughts(10000);await page.waitFor('qqaWineFox.state().thoughtCount===1',{timeout:3000});ok('无人互动10秒增加首个屏幕气泡',true);
 await advanceThoughts(20000);await page.waitFor('qqaWineFox.state().thoughtCount===4',{timeout:3000});ok('气泡随等待逐步增多',true);
 await advanceThoughts(180000);await page.waitFor('qqaWineFox.state().thoughtCount===qqaWineFox.state().thoughtCapacity',{timeout:3000});ok('最终气泡铺满视口且节点数量受控',await page.eval('qqaWineFox.state().thoughtCount<=192 && document.querySelector(".wine-fox-thought-cloud").getBoundingClientRect().width===innerWidth && getComputedStyle(document.querySelector(".wine-fox-thought-cloud")).pointerEvents==="none"'));
 await page.screenshot('shots/final/wine-fox-thought-fullscreen.png');
 const home=await page.eval('qqaWineFox.state().homePoint');p=await point();await mouse('mousePressed',p);await mouse('mouseMoved',{x:p.x-80,y:p.y-30});ok('互动立即清空所有呆住气泡',await page.eval('qqaWineFox.state().thoughtCount===0 && document.querySelector(".wine-fox-thought-cloud").hidden && !document.querySelector("#wine-fox-pet .wine-fox-thought")'));ok('呆住拖动不Fly',await page.eval('qqaWineFox.state().animation!=="fly"'));await mouse('mouseReleased',{x:p.x-80,y:p.y-30});ok('情绪下run朝向原位返回',await page.eval('qqaWineFox.state().returning && qqaWineFox.state().animation==="run" && qqaWineFox.state().facingTarget>0'));
 await page.waitFor('!qqaWineFox.state().returning',{timeout:5000});ok('回到原位并恢复情绪动作',await page.eval(`qqaWineFox.state().motionKind==='mood' && Math.hypot(qqaWineFox.state().position[0]-${home[0]},qqaWineFox.state().position[1]-${home[1]})<2`));
 await page.eval('document.querySelector("#wine-fox-pet canvas").focus()');await key();await key();await key();ok('闲置情绪点击恢复',await page.eval('qqaWineFox.state().mood==="normal"'));
 await page.eval('qqaSkin.apply("default")');ok('离开MC销毁宠物和菜单',await page.eval('!document.getElementById("wine-fox-pet") && !document.querySelector(".wine-fox-menu") && !document.querySelector(".wine-fox-thought-cloud")'));
 await page.eval('qqaSkin.apply("minecraft");qqaSkin.apply("default")');await sleep(300);ok('取消加载无迟到实例',await page.eval('!document.getElementById("wine-fox-pet") && !document.querySelector(".wine-fox-menu")'));
 ok('无运行异常和CSP错误',!logs.some(l=>/\[exception\]|\[error\]|Content Security Policy|Refused to/.test(l)));
});}catch(e){ok('验收运行完成',false);console.error(e.stack);}
fs.writeFileSync('shots/final/wine-fox-checks.json',JSON.stringify({results},null,2));console.log(`${results.length-fail}/${results.length} 通过`);process.exitCode=fail?2:0;
