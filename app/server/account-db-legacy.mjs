// JSON decoding is confined to official-format imports and upgrading the earlier v1 prototype.
import fs from 'node:fs';import path from 'node:path';import {gunzipSync} from 'node:zlib';
export function upgradeV1(db,root,write){
 const backup=path.join(root,'storage-v1-'+Date.now()+'.sqlite');db.prepare('VACUUM INTO ?').run(backup);
 db.transaction(()=>{
  for(const row of db.prepare('SELECT * FROM chats').all()){const value={...JSON.parse(row.meta),messages:db.prepare('SELECT body FROM messages WHERE chat=? ORDER BY id').all(row.path).map(m=>JSON.parse(m.body))};write(db,row.path,value,row.mtime);}
  let after='';for(;;){const batch=db.prepare('SELECT * FROM documents WHERE path>? ORDER BY path LIMIT 8').all(after);if(!batch.length)break;for(const row of batch){write(db,row.path,JSON.parse(gunzipSync(row.payload).toString('utf8').replace(/^\uFEFF/,'')),row.mtime);after=row.path;}}
  db.exec('DROP TABLE messages;DROP TABLE chats;DROP TABLE documents;');db.prepare("INSERT OR REPLACE INTO storage_meta VALUES('schema','2')").run();db.prepare("INSERT OR REPLACE INTO storage_meta VALUES('v1-backup',?)").run(path.basename(backup));
 })();
 db.pragma('wal_checkpoint(TRUNCATE)');db.exec('VACUUM');
}
export function importLegacy(db,root,write){
 const files=[],names=['messages','sessions','memory'];const walk=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.json'))files.push(f);}};for(const n of names)walk(path.join(root,n));
 // Also import existing accounting/index caches once; ordinary saves use native SQL records.
 for(const n of ['session-index-cache.json','usage-today.json','telemetry-totals.json','usage-daily.json']){const f=path.join(root,n);if(fs.existsSync(f))files.push(f);}walk(path.join(root,'usage-days'));
 const backup='storage-legacy-'+Date.now();
 db.transaction(()=>{for(const f of files)write(db,path.relative(root,f).replaceAll('\\','/'),JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),fs.statSync(f).mtimeMs);db.prepare("INSERT INTO storage_meta VALUES('migrated',?)").run(JSON.stringify({at:Date.now(),files:files.length,backup}));})();
 archiveLegacy(db,root);
}
export function archiveLegacy(db,root){
 if(db.prepare("SELECT value FROM storage_meta WHERE key='archived'").get())return;const value=db.prepare("SELECT value FROM storage_meta WHERE key='migrated'").get()?.value;if(!value)return;const imported=JSON.parse(value);if(!imported.files){db.prepare("INSERT OR REPLACE INTO storage_meta VALUES('archived','1')").run();return;}
 const backup=path.join(root,path.basename(imported.backup));fs.mkdirSync(backup,{recursive:true});
 for(const n of ['messages','sessions','memory','usage-days','session-index-cache.json','usage-today.json','telemetry-totals.json','usage-daily.json']){const from=path.join(root,n),to=path.join(backup,n);if(!fs.existsSync(to)&&fs.existsSync(from))fs.renameSync(from,to);if(['messages','sessions','memory','usage-days'].includes(n))fs.mkdirSync(from,{recursive:true});}
 db.prepare("INSERT OR REPLACE INTO storage_meta VALUES('archived','1')").run();
}
// Existing v1 accounting files are imported once; runtime callers subsequently use SQL objects.
export function importAuxiliary(db,root,write){
 const completed=db.prepare("SELECT value FROM storage_meta WHERE key='native-aux'").get()?.value;
 if(completed){if(completed!=='empty')archiveAuxiliary(root,completed);return;}
 const names=['session-index-cache.json','usage-today.json','telemetry-totals.json','usage-daily.json'],files=[];
 for(const name of names){const file=path.join(root,name);if(fs.existsSync(file))files.push(file);}
 const walk=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(e.name.endsWith('.json'))files.push(file);}};walk(path.join(root,'usage-days'));walk(path.join(root,'memory/backups'));
 const backup='storage-aux-'+Date.now();
 db.transaction(()=>{for(const file of files)write(db,path.relative(root,file).replaceAll('\\','/'),JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),fs.statSync(file).mtimeMs);db.prepare("INSERT OR REPLACE INTO storage_meta VALUES('native-aux',?)").run(files.length?backup:'empty');})();
 if(files.length)archiveAuxiliary(root,backup);
}

function archiveAuxiliary(root,backup){
 const destination=path.join(root,path.basename(backup));
 const move=file=>{const target=path.join(destination,path.relative(root,file));if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(file,target);}};
 for(const name of ['session-index-cache.json','usage-today.json','telemetry-totals.json','usage-daily.json']){const file=path.join(root,name);if(fs.existsSync(file))move(file);}
 const walk=dir=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.json'))move(file);}};
 walk(path.join(root,'usage-days'));walk(path.join(root,'memory/backups'));
}
