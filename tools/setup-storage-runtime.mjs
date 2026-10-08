import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
// Driver versions and native ABI are deliberately pinned. Rebuild for other Electron versions.
const root=path.resolve('app/server/storage-runtime'),version='12.11.1',expected='359cbd480d7c5b2e4693a68605dc1429e05c48d04016b7aa2ac0b04d6b176b17';
if(!process.argv.includes('--apply')){console.log('Use --apply to install the pinned npm driver and official Electron ABI 130 binary.');process.exit(0);}
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--no-audit','--no-fund'],{cwd:root,stdio:'inherit',windowsHide:true,shell:process.platform==='win32'});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qqa-storage-driver-')),archive=path.join(temp,'driver.tar.gz');
const response=await fetch(`https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-electron-v130-win32-x64.tar.gz`);if(!response.ok)throw Error('Official native download failed: '+response.status);
fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()));execFileSync('tar',['-xzf',archive,'-C',temp],{windowsHide:true});
const binary=fs.readFileSync(path.join(temp,'build/Release/better_sqlite3.node'));if(createHash('sha256').update(binary).digest('hex')!==expected)throw Error('Native driver hash mismatch; refusing deployment');
fs.mkdirSync(path.join(root,'native'),{recursive:true});fs.writeFileSync(path.join(root,'native/electron-130.node'),binary);console.log('Pinned SQLite runtime prepared and native SHA-256 verified.');
