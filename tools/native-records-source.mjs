import fs from 'node:fs';
function end(text,start){let depth=0,quote='',escape=false;for(let i=start;i<text.length;i++){const c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='(')depth++;if(c===')'&&!--depth)return i;}throw Error('Unbalanced JavaScript call');}
function args(text){const result=[];let quote='',escape=false,depth=0,last=0;for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;else if(c===','&&!depth){result.push(text.slice(last,i).trim());last=i+1;}}result.push(text.slice(last).trim());return result;}
export function patchNativeRecords(name,source){if(source.includes('// ARCFØX native SQL records v2'))return source;let s=source.replaceAll('\r\n','\n');
 const replace=(before,after)=>{if(!s.includes(before))throw Error('Native record anchor changed: '+name+' '+before.slice(0,50));s=s.replace(before,after);};
 if(name==='arcfox-usage-reader.mjs')s=s.replace('JSON.stringify([dir,files,fromTs])',"dir+'\\0'+files.join('\\0')+'\\0'+fromTs");
 if(name==='store.js'){
  const start=s.indexOf('function loadChat('),stop=s.indexOf('\nfunction saveChat(',start);if(start<0||stop<0)throw Error('Chat loader anchor');s=s.slice(0,start)+`function loadChat(dir,chatKey){try{return readValue(chatFile(dir,chatKey));}catch(e){if(e.code!=='ENOENT')throw e;return {chatKey,nextLocalId:1,messages:[]};}}\n`+s.slice(stop);
  const a=s.indexOf('  listChats() {'),b=s.indexOf('\n  getChatMeta(',a);s=s.slice(0,a)+`  listChats(){const paths=databaseFor(path.dirname(this.messagesDir)).request('chatList');return [...new Set([...paths.map(p=>/^(group|private)_(\\d+)\\.json$/.exec(p.split('/').at(-1))).filter(Boolean).map(m=>m[1]+':'+m[2]),...this.chats.keys()])];}\n`+s.slice(b);
  replace('  getChatMeta(chatKey) {',`  getChatMeta(chatKey) {\n    if(!this.chats.has(chatKey))return databaseFor(path.dirname(this.messagesDir)).request('chatMeta',{file:'messages/'+String(chatKey).replace(/[^a-z0-9_]/gi,'_')+'.json',chatKey});`);
  replace('  recent(chatKey, { limit = 80, offset = 0, includeSelf = true } = {}) {',`  recent(chatKey, { limit = 80, offset = 0, includeSelf = true } = {}) {\n    if(!this.chats.has(chatKey))return databaseFor(path.dirname(this.messagesDir)).request('chatRecent',{file:'messages/'+String(chatKey).replace(/[^a-z0-9_]/gi,'_')+'.json',limit:Math.max(1,Number(limit)||1),offset:Math.max(0,Number(offset)||0),includeSelf});`);
 }
 if(name==='memory.js'){
  replace("    let text = fs.readFileSync(file, 'utf8');\n    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);\n    const parsed = JSON.parse(text);",'    const parsed = readValue(file);');
  s=s.replace('function legacyFile(chatKey)', 'function legacyFile(dir,chatKey)').replace('return path.join(MEMORY_DIR, `${chatDirName(chatKey)}.json`);','return path.join(dir || MEMORY_DIR, `${chatDirName(chatKey)}.json`);').replaceAll('legacyFile(chatKey)','legacyFile(this.memoryDir,chatKey)');
 }
 if(name==='sessions.js'){
  const fields="['id','chatKey','startedAt','endedAt','status','waitUntil','activity','webSearchCount','outcome','usage','model','triggerSummary','promptChars','rounds']";
  for(const method of ['#loadOne','#reclaimZombies']){
   const a=s.indexOf('  '+method+'('),b=s.indexOf('\n  }',a);let segment=s.slice(a,b);const variable=method==='#loadOne'?'file':'f';
   segment=segment.replace("JSON.parse(fs.readFileSync(path.join(this.sessionsDir, "+variable+"), 'utf8'))","databaseFor(this.dataDir).request('header',{file:'sessions/'+"+variable+",fields:"+fields+"})");
   segment=segment.replace("data.status = 'aborted';","Object.assign(data,readValue(path.join(this.sessionsDir,"+variable+")));\n        data.status = 'aborted';");s=s.slice(0,a)+segment+s.slice(b);
  }
 }
 if(name==='arcfox-usage-parser.mjs')s=s.replace("JSON.parse(fs.readFileSync(fp, 'utf8'))","databaseFor(path.dirname(dir)).request('usageRecord',{file:'sessions/'+f})");
 // Replace only filesystem JSON boundaries; HTTP, OneBot, config and UI protocols remain independent.
 let pos=0;while((pos=s.indexOf('JSON.parse(fs.readFileSync(',pos))>=0){const open=pos+'JSON.parse'.length,close=end(s,open),inner=s.slice(open+1,close);const fstart=inner.indexOf('('),fend=end(inner,fstart),parameters=args(inner.slice(fstart+1,fend));s=s.slice(0,pos)+'readValue('+parameters[0]+')'+s.slice(close+1);pos+=10;}
 pos=0;while((pos=s.indexOf('fs.writeFileSync(',pos))>=0){const open=pos+'fs.writeFileSync'.length,close=end(s,open),parameters=args(s.slice(open+1,close));if(parameters[1]?.startsWith('JSON.stringify(')){const expression=parameters[1],jopen=expression.indexOf('('),jclose=end(expression,jopen),value=args(expression.slice(jopen+1,jclose))[0];const next='writeValue('+parameters[0]+','+value+')';s=s.slice(0,pos)+next+s.slice(close+1);pos+=next.length;}else pos=close+1;}
 if(name==='arcfox-usage-parser.mjs')s="import {databaseFor} from './account-db-client.mjs';\n"+s;
 return "// ARCFØX native SQL records v2\nimport {readValue,writeValue} from './account-storage-records.mjs';\n"+s;
}
