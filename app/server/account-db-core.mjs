import fs from 'node:fs';
import path from 'node:path';
import {serialize,deserialize} from 'node:v8';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {importLegacy,upgradeV1,archiveLegacy,importAuxiliary} from './account-db-legacy.mjs';
const require=createRequire(import.meta.url),Database=require('./storage-runtime/node_modules/better-sqlite3');
export const DB_NAME='account-storage.sqlite';
const statements=new WeakMap(),clocks=new WeakMap();
const sql=(db,text)=>{let cache=statements.get(db);if(!cache)statements.set(db,cache=new Map());let s=cache.get(text);if(!s){s=db.prepare(text);cache.set(text,s);}return s;};
function stamp(db){const n=Math.max(Date.now(),(clocks.get(db)||0)+0.01);clocks.set(db,n);return n;}
export function pack(value){const data=serialize(value);return data.length>256?Buffer.concat([Buffer.from([1]),gzipSync(data,{level:1})]):Buffer.concat([Buffer.from([0]),data]);}
export function unpack(data){if(!data)return {};return deserialize(data[0]===1?gunzipSync(data.subarray(1)):data.subarray(1));}
export function openDatabase(root,{readonly=false,migrate=true}={}){
 root=path.resolve(root);if(!readonly)fs.mkdirSync(root,{recursive:true});
 const nativeBinding=process.versions.modules==='130'?path.join(path.dirname(fileURLToPath(import.meta.url)),'storage-runtime/native/electron-130.node'):undefined;
 const db=new Database(path.join(root,DB_NAME),{readonly,...(nativeBinding?{nativeBinding}:{}),timeout:5000});
 if(readonly){db.pragma('query_only=ON');return db;}
 db.pragma('journal_mode=WAL');db.pragma('synchronous=FULL');db.pragma('cache_size=-2048');db.pragma('busy_timeout=5000');
 db.exec(`CREATE TABLE IF NOT EXISTS storage_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_rows(path TEXT PRIMARY KEY,chat_key TEXT,next_id INTEGER,extra BLOB,mtime REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS message_rows(chat TEXT,id INTEGER,mask INTEGER,mid,ts REAL,sender_id TEXT,sender_name TEXT,text TEXT,self INTEGER,read INTEGER,poke INTEGER,at_me INTEGER,recalled INTEGER,extra BLOB,PRIMARY KEY(chat,id)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS message_media(chat TEXT,id INTEGER,position INTEGER,kind TEXT,url TEXT,file TEXT,summary TEXT,face_id,extra BLOB,PRIMARY KEY(chat,id,position)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS message_replies(chat TEXT,id INTEGER,sender TEXT,text TEXT,extra BLOB,PRIMARY KEY(chat,id)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS records(path TEXT PRIMARY KEY,shape INTEGER,mtime REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS record_fields(path TEXT,name TEXT,kind INTEGER,text_value TEXT,number_value REAL,data BLOB,PRIMARY KEY(path,name)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS record_items(path TEXT,name TEXT,position INTEGER,kind INTEGER,role TEXT,content TEXT,created_at REAL,data BLOB,prompt_tokens REAL,completion_tokens REAL,cached_tokens REAL,raw_created REAL,raw_model TEXT,tool_name TEXT,PRIMARY KEY(path,name,position)) WITHOUT ROWID;`);
 const version=sql(db,"SELECT value FROM storage_meta WHERE key='schema'").get()?.value;
 if(version&&version!=='1'&&version!=='2')throw Error('Unsupported storage schema');
 if(version==='1')upgradeV1(db,root,writeRecord);
 if(migrate&&!sql(db,"SELECT value FROM storage_meta WHERE key='migrated'").get())importLegacy(db,root,writeRecord);
 archiveLegacy(db,root);
 importAuxiliary(db,root,writeRecord);
 sql(db,"INSERT OR REPLACE INTO storage_meta VALUES('schema','2')").run();
 db.pragma('journal_size_limit=4194304');db.pragma('wal_checkpoint(TRUNCATE)');return db;
}
const names=['mid','ts','senderId','senderName','text','self','read','isPoke','atMe','recalled'];
const safeText=v=>typeof v==='string'&&v.isWellFormed();
const bools=new Set(['self','read','isPoke','atMe','recalled']);
function writeMessage(db,chat,m){
 if(!Number.isSafeInteger(m.id))throw Error('Invalid local message ID');
 let mask=0;const extra={...m};delete extra.id;const values=names.map((name,i)=>{if(Object.hasOwn(m,name))mask|=1<<i;const v=m[name];const valid=v==null||(bools.has(name)?typeof v==='boolean':['senderId','senderName','text'].includes(name)?safeText(v):['ts'].includes(name)?typeof v==='number':typeof v==='number'||safeText(v));if(valid)delete extra[name];return !valid||v==null?null:bools.has(name)?Number(v):v;});
 sql(db,'DELETE FROM message_media WHERE chat=? AND id=?').run(chat,m.id);sql(db,'DELETE FROM message_replies WHERE chat=? AND id=?').run(chat,m.id);
 if(Array.isArray(m.media)){mask|=1<<10;delete extra.media;for(let i=0;i<m.media.length;i++){const e=m.media[i];if(!e||typeof e!=='object')throw Error('Invalid message media');const rest={...e};for(const k of ['kind','url','file','summary','faceId'])if(e[k]==null||(k==='faceId'?typeof e[k]==='number'||safeText(e[k]):safeText(e[k])))delete rest[k];const present=['kind','url','file','summary','faceId'].filter(k=>Object.hasOwn(e,k));sql(db,'INSERT INTO message_media VALUES(?,?,?,?,?,?,?,?,?)').run(chat,m.id,i,safeText(e.kind)?e.kind:null,safeText(e.url)?e.url:null,safeText(e.file)?e.file:null,safeText(e.summary)?e.summary:null,typeof e.faceId==='number'||safeText(e.faceId)?e.faceId:null,pack({values:rest,present}));}}
 if(m.reply&&typeof m.reply==='object'&&!Array.isArray(m.reply)){mask|=1<<11;const {sender,text}=m.reply,rest={...m.reply};if(sender==null||safeText(sender))delete rest.sender;if(text==null||safeText(text))delete rest.text;const present=['sender','text'].filter(k=>Object.hasOwn(m.reply,k));sql(db,'INSERT INTO message_replies VALUES(?,?,?,?,?)').run(chat,m.id,safeText(sender)?sender:null,safeText(text)?text:null,pack({values:rest,present}));delete extra.reply;}
 sql(db,'INSERT OR REPLACE INTO message_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(chat,m.id,mask,...values,pack(extra));
}
function decodeMessages(db,chat,rows){
 const result=rows.map(row=>{const m={id:row.id},cols=[row.mid,row.ts,row.sender_id,row.sender_name,row.text,row.self,row.read,row.poke,row.at_me,row.recalled];names.forEach((name,i)=>{if(row.mask&(1<<i))m[name]=cols[i]===null?null:bools.has(name)?Boolean(cols[i]):cols[i];});Object.assign(m,unpack(row.extra));if(row.mask&(1<<10))m.media=[];return m;});
 if(!rows.length)return result;const selected=new Map(result.map(m=>[m.id,m])),lo=rows.reduce((n,r)=>Math.min(n,r.id),Infinity),hi=rows.reduce((n,r)=>Math.max(n,r.id),0);
 for(const row of sql(db,'SELECT * FROM message_media WHERE chat=? AND id>=? AND id<=? ORDER BY id,position').all(chat,lo,hi)){const m=selected.get(row.id);if(!m)continue;const {values:e,present:keys}=unpack(row.extra);const cols={kind:row.kind,url:row.url,file:row.file,summary:row.summary,faceId:row.face_id};for(const key of keys)if(!Object.hasOwn(e,key))e[key]=cols[key];m.media.push(e);}
 for(const row of sql(db,'SELECT * FROM message_replies WHERE chat=? AND id>=? AND id<=?').all(chat,lo,hi)){const m=selected.get(row.id);if(!m)continue;const {values:e,present:keys}=unpack(row.extra);for(const key of keys)if(!Object.hasOwn(e,key))e[key]=row[key];m.reply=e;}
 return result;
}
function writeMeta(db,file,meta,mtime){const {chatKey,nextLocalId,...extra}=meta;sql(db,'INSERT OR REPLACE INTO chat_rows VALUES(?,?,?,?,?)').run(file,chatKey??null,nextLocalId??1,pack(extra),mtime);}
export function writeRecord(db,file,value,mtime=stamp(db)){
 if(/^messages\/[^/]+\.json$/.test(file)){
  if(!Array.isArray(value.messages))throw Error('Invalid message state');const {messages,...meta}=value;writeMeta(db,file,meta,mtime);eraseMessages(db,file);for(const m of messages)writeMessage(db,file,m);return;
 }
 sql(db,'INSERT OR REPLACE INTO records VALUES(?,?,?)').run(file,Array.isArray(value)?1:0,mtime);sql(db,'DELETE FROM record_fields WHERE path=?').run(file);sql(db,'DELETE FROM record_items WHERE path=?').run(file);
 for(const [name,v] of Object.entries(value)){
  let kind=0,text=null,number=null,data=null;
  if(v===null)kind=0;else if(safeText(v)){if(['systemPrompt','userPrompt'].includes(name)&&v.length>1024){kind=6;data=gzipSync(Buffer.from(v,'utf8'),{level:1});}else{kind=1;text=v;}}else if(typeof v==='number'){kind=2;number=v;}else if(typeof v==='boolean'){kind=3;number=Number(v);}else if(Array.isArray(v)&&['messages','impressions'].includes(name)){
   kind=5;for(let i=0;i<v.length;i++){const e=v[i];let role=null,content=null,at=null,rest=e,type=0;
    if(e&&typeof e==='object'&&!Array.isArray(e)){type=1;rest={...e};if(safeText(e.content)){content=e.content;delete rest.content;}if(safeText(e.role)){role=e.role;delete rest.role;}if(typeof e.createdAt==='number'){at=e.createdAt;delete rest.createdAt;}}
    const raw=e?.raw,usage=raw?.usage||{};sql(db,'INSERT INTO record_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(file,name,i,type,role,content,at,pack(rest),Number(usage.prompt_tokens)||0,Number(usage.completion_tokens)||0,Number(usage.prompt_tokens_details?.cached_tokens)||0,Number(raw?.created)||0,String(raw?.model||''),e?.toolCall?.name?String(e.toolCall.name):null);
   }
  }else{kind=4;data=pack(v);}
  sql(db,'INSERT INTO record_fields VALUES(?,?,?,?,?,?)').run(file,name,kind,text,number,data);
 }
}
export function readRecord(db,file){
 const chat=sql(db,'SELECT * FROM chat_rows WHERE path=?').get(file);if(chat)return {...unpack(chat.extra),chatKey:chat.chat_key,nextLocalId:chat.next_id,messages:decodeMessages(db,file,sql(db,'SELECT * FROM message_rows WHERE chat=? ORDER BY id').all(file))};
 const record=sql(db,'SELECT shape FROM records WHERE path=?').get(file);if(!record){const e=Error('Storage record not found');e.code='ENOENT';throw e;}
 const value=record.shape?[]:{};for(const row of sql(db,'SELECT * FROM record_fields WHERE path=?').all(file)){
  let v;if(row.kind===0)v=null;else if(row.kind===1)v=row.text_value;else if(row.kind===2)v=row.number_value;else if(row.kind===3)v=Boolean(row.number_value);else if(row.kind===4)v=unpack(row.data);else if(row.kind===6)v=gunzipSync(row.data).toString('utf8');else v=sql(db,'SELECT * FROM record_items WHERE path=? AND name=? ORDER BY position').all(file,row.name).map(r=>{const e=unpack(r.data);if(r.kind!==1)return e;if(r.role!==null)e.role=r.role;if(r.content!==null)e.content=r.content;if(r.created_at!==null)e.createdAt=r.created_at;return e;});
  Object.defineProperty(value,row.name,{value:v,enumerable:true,writable:true,configurable:true});
 }return value;
}
function eraseMessages(db,file,ids){for(const table of ['message_rows','message_media','message_replies']){const stmt=sql(db,`DELETE FROM ${table} WHERE chat=?${ids?' AND id=?':''}`);if(ids){for(const id of ids)stmt.run(file,id);}else stmt.run(file);}}
export function listPaths(db,file=''){const where=file?' WHERE path=? OR (path>=? AND path<?)':'';return sql(db,'SELECT path,mtime FROM records'+where+' UNION ALL SELECT path,mtime FROM chat_rows'+where).all(...(file?[file,file+'/',file+'0',file,file+'/',file+'0']:[]));}
export function deleteRecord(db,file,recursive=false){const rows=listPaths(db,file).filter(r=>recursive||r.path===file);for(const r of rows){eraseMessages(db,r.path);for(const table of ['chat_rows','records','record_fields','record_items'])sql(db,`DELETE FROM ${table} WHERE path=?`).run(r.path);}return rows.length;}
function readHeader(db,file,fields){
 if(!sql(db,'SELECT 1 FROM records WHERE path=?').get(file)){const e=Error('Record not found');e.code='ENOENT';throw e;}
 const out={};if(!fields.length)return out;
 for(const row of sql(db,'SELECT * FROM record_fields WHERE path=? AND name IN ('+fields.map(()=>'?').join(',')+')').all(file,...fields)){
  const value=row.kind===0?null:row.kind===1?row.text_value:row.kind===2?row.number_value:row.kind===3?Boolean(row.number_value):row.kind===4?unpack(row.data):row.kind===6?gunzipSync(row.data).toString('utf8'):[];
  Object.defineProperty(out,row.name,{value,enumerable:true,writable:true,configurable:true});
 }return out;
}
export function operate(db,op,args={}){
 const {file}=args;
 if(op==='header')return readHeader(db,file,args.fields);
 if(op==='usageRecord'){const value=readHeader(db,file,['id','startedAt','chatKey','model','vendor','usage','webSearchCount']);value.messages=sql(db,"SELECT prompt_tokens,completion_tokens,cached_tokens,raw_created,raw_model,tool_name FROM record_items WHERE path=? AND name='messages' ORDER BY position").all(file).map(r=>({raw:{usage:{prompt_tokens:r.prompt_tokens,completion_tokens:r.completion_tokens,prompt_tokens_details:{cached_tokens:r.cached_tokens}},created:r.raw_created,model:r.raw_model},...(r.tool_name?{toolCall:{name:r.tool_name}}:{})}));return value;}
 if(op==='get')return readRecord(db,file);
 if(op==='list')return listPaths(db,file);
 if(op==='stat'){const r=sql(db,'SELECT path,mtime FROM records WHERE path=? UNION ALL SELECT path,mtime FROM chat_rows WHERE path=?').get(file,file);if(r)return {...r,dir:false,bytes:0};const rows=listPaths(db,file);return rows.length?{dir:true,mtime:rows.reduce((n,r)=>Math.max(n,r.mtime),0),bytes:0}:null;}
 if(op==='put')return db.transaction(()=>writeRecord(db,file,args.value))();
 if(op==='delete')return db.transaction(()=>deleteRecord(db,file,args.recursive))();
 if(op==='chatDelta')return db.transaction(()=>{writeMeta(db,file,args.meta,stamp(db));for(const m of args.upserts)writeMessage(db,file,m);eraseMessages(db,file,args.removed);})();
 if(op==='chatList')return sql(db,'SELECT path FROM chat_rows ORDER BY path').all().map(r=>r.path);
 if(op==='chatRecent'){const rows=sql(db,`SELECT * FROM message_rows WHERE chat=?${args.includeSelf===false?' AND coalesce(self,0)=0':''} ORDER BY id DESC LIMIT ? OFFSET ?`).all(file,args.limit,args.offset);return decodeMessages(db,file,rows.reverse());}
 if(op==='chatMeta'){const counts=sql(db,'SELECT count(*) total,sum(CASE WHEN coalesce(read,0)=0 AND coalesce(self,0)=0 THEN 1 ELSE 0 END) unread FROM message_rows WHERE chat=?').get(file),last=sql(db,'SELECT ts,text,extra FROM message_rows WHERE chat=? ORDER BY id DESC LIMIT 1').get(file);return {chatKey:args.chatKey,total:counts.total,unread:counts.unread||0,lastTs:last?.ts||0,lastText:(last?(unpack(last.extra).text??last.text):'')??''};}
 if(op==='flush')return {version:sql(db,'select sqlite_version() v').get().v,journal:db.pragma('journal_mode',{simple:true}),schema:2};
 if(op==='checkpoint'){db.pragma('wal_checkpoint(TRUNCATE)');return true;}
 throw Error('Unknown database operation');
}
