// 有限设置语义解析；完全本地，不请求模型，不执行自由文本代码。
const aliases={
 'cfg-autostart':['开机自启','开机自启动','开机启动','自启动','自启'],
 'cfg-closetray':['关闭到托盘','关闭时最小化','最小化到托盘','关闭托盘'],
 'cfg-refreshms':['界面刷新间隔','刷新间隔','刷新时间'],
 'mc-bg-on':['背景图','壁纸','背景'], 'mc-bg-opacity':['背景可见度','背景透明度','背景透明','背景亮度'],
 'mc-sfx-on':['互动音效','音效总开关','音效'], 'mc-motion-on':['界面动效','界面动画','动效','动画'],
 'mc-sfx-volume':['互动音效总音量','总音量','音量','声音'], 'mc-clickVolume':['点击音量','点击音音量','按钮音量','点击声音'],
 'mc-toggleVolume':['开关音量','开关音音量','拉杆音量'], 'mc-sliderVolume':['滑条音量','滑块音量','滑条音音量'],
 'cfg-websearch':['联网搜索','网络搜索','联网功能'], 'cfg-mem-consolidate':['记忆整理','自动整理记忆'],
 'cfg-proactive':['主动聊天','主动发言'], 'cfg-sticker':['表情包','贴纸'],
 'cfg-persona-history-days':['人设记录保留时间','人设记录保存天数'], 'cfg-persona-history-limit':['人设记录条数','人设记录数量'],
 'sc-temperature':['模型温度','温度'], 'sc-maxrounds':['最大工具轮数','工具轮数'],
};
const normalize=s=>String(s).toLowerCase().replace(/[\s“”「」'"（()）]/g,'');
function number(s){if(/^-?\d+(\.\d+)?$/.test(s))return Number(s);const digits='零一二三四五六七八九';let total=0,current=0;for(const c of s){if(c==='两'){current=2;continue;}const n=digits.indexOf(c);if(n>=0)current=n;else if('十百千'.includes(c)){total+=(current||1)*({十:10,百:100,千:1000}[c]);current=0;}else return NaN;}return total+current;}
function find(text,catalog,last){
 const hits=[];for(const c of catalog){const names=[...(aliases[c.id]||[]),c.label.replace(/（.*?）|\(.*?\)/g,'').trim()];let score=0;for(const name of names){const n=normalize(name);if(n.length>1&&text.includes(n))score=Math.max(score,n.length);}if(score)hits.push({c,score});}
 hits.sort((a,b)=>b.score-a.score);if(hits.length&&hits[1]?.score===hits[0].score)return null;return hits[0]?.c||(/^(再|继续|它|这个|调|小|大)/.test(text)?catalog.find(c=>c.id===last):null);
}
export function interpretFox(message,catalog,last=null){
 const parts=String(message).trim().split(/[，,。；;！!\n]+|并且|然后|同时|还有|以及|并(?=把|帮|打开|关闭|调)|和(?=打开|关闭|开启|关掉|调)/).map(s=>s.trim()).filter(Boolean),actions=[],replies=[];
 const fail=reply=>({reply,actions:[],last});
 for(const raw of parts){const text=normalize(raw);if(/^(早上好|晚上好|下午好|你好|嗨|谢谢|辛苦了|早安|晚安|酒狐)[呀啊哦～~]*$/.test(text)){replies.push(/谢谢|辛苦/.test(text)?'不客气，ご主人様～':'你好，ご主人様～');continue;}
  const c=find(text,catalog,last);if(!c)return fail('我在本地还没认出这个设置。可以说“关闭开机自启”“总音量调到35%”或“音量再小一点”。');
  if(/是否|是不是|多少|查看|当前|现在.*(开启|关闭)|开着吗|关着吗|关了没|开了没|开启了吗|关闭了吗/.test(text)){replies.push(c.label+'现在是'+(c.type==='checkbox'?(c.value?'开启':'关闭'):c.value)+'。');last=c.id;continue;}
  if(/如果|假如|怎么|如何|能不能|可以.*吗|要不要/.test(text))return fail('你可以直接告诉我：'+(c.type==='checkbox'?'开启或关闭':'把数值调到多少')+'“'+c.label+'”。');
  const names=[...(aliases[c.id]||[]),c.label.replace(/（.*?）|\(.*?\)/g,'').trim()].map(normalize).sort((a,b)=>b.length-a.length);const name=names.find(n=>n.length>1&&text.includes(n));const command=name?text.replace(name,''):text;
  let value;
  if(c.type==='checkbox'){
   if(/不要关闭|别关闭|不关闭|别关掉/.test(command))value=true;
   else if(/不要打开|不要开启|别打开|别开启|不启用|不用开|关闭|关掉|关上|关了|禁用|停用|取消|关闭掉|关一下/.test(command))value=false;
   else if(/打开|开启|启用|开起来|开一下/.test(command))value=true;
   else if(/切换|反转/.test(command))value=!c.value;
   else return fail('你想开启还是关闭“'+c.label+'”？');
  }else{
   const numericText=command.replace(/一点/g,'点');const match=numericText.match(/百分之(-?\d+(?:\.\d+)?|[零一二两三四五六七八九十百千]+)/)||numericText.match(/(-?\d+(?:\.\d+)?|[零一二两三四五六七八九十百千]+)(%|％|毫秒|秒|分钟|小时|天|条|次)?/);let amount=match?number(match[1]):null;
   if(amount!==null&&/毫秒/.test(c.label)){amount*=({秒:1000,分钟:60000,小时:3600000}[match[2]]||1);}
   const down=/降低|减少|减小|调低|调小|小一点|低一点|小点|低点|安静一点|暗一点/.test(text),up=/提高|增加|增大|调高|调大|大一点|高一点|大点|高点|亮一点/.test(text);
   const absolute=/调(?:高|低|大|小)?到|设为|设成|设置为|改为|改成|变成|调整到/.test(text)||(!down&&!up&&amount!==null);
   if(/最大|最高|拉满/.test(text)&&c.max!==undefined)value=c.max;
   else if(/最小|最低/.test(text)&&c.min!==undefined)value=c.min;
   else if(absolute&&amount!==null)value=amount;
   else if(down||up){const delta=amount??(Number.isFinite(c.max)&&Number.isFinite(c.min)?(c.max-c.min)*.1:c.step||1);value=c.value+(down?-delta:delta);}
   else return fail('请告诉我“'+c.label+'”要调到多少，或说调大/调小一点。');
   if(!Number.isFinite(value)||(c.min!==undefined&&value<c.min)||(c.max!==undefined&&value>c.max))return fail('“'+c.label+'”超出允许范围'+(c.min??'')+'～'+(c.max??'')+'，请换一个数值。');
   if(c.step>0)value=Number(((c.min||0)+Math.round((value-(c.min||0))/c.step)*c.step).toFixed(8));
   if((c.max!==undefined&&value>c.max)||(c.min!==undefined&&value<c.min))return fail('这个数值不符合控件范围与步长。');
  }
  if(actions.some(a=>a.id===c.id))return fail('同一个设置出现了多次，请分别告诉我最终要设置成什么。');
  actions.push({id:c.id,value,previous:c.value});last=c.id;if(actions.length>6)return fail('一次最多帮你调整六项设置。');
 }
 return {reply:replies.join(' ')+(actions.length?'我来帮你调整：'+actions.map(a=>catalog.find(c=>c.id===a.id).label+' → '+(typeof a.value==='boolean'?(a.value?'开启':'关闭'):a.value)).join('；')+'。':''),actions,last};
}
