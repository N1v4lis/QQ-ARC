// Run only for an explicitly authorized GitHub release. Credentials remain in memory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),tag='v'+version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Unexpected version');
if(git('status','--porcelain'))throw Error('Commit all release files first');
if(git('remote','get-url','origin')!=='https://github.com/N1v4lis/QQARCFOX.git')throw Error('Unexpected release repository');
const head=git('rev-parse','HEAD');if(git('rev-parse',tag+'^{commit}')!==head)throw Error('Tag is not the release commit');
for(const ref of ['refs/heads/main','refs/tags/'+tag+'^{}'])if(!git('ls-remote','origin',ref).startsWith(head))throw Error('Push and verify main and annotated tag before publishing');
const credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
const token=credential.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);if(!token)throw Error('GitHub credential unavailable');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const base='https://api.github.com/repos/N1v4lis/QQARCFOX';
async function api(route,options={}){const response=await fetch(base+route,{...options,headers:{...headers,...options.headers}});if(!response.ok)throw Error('GitHub HTTP '+response.status+' for '+route);return response.json();}
if(!(await api('')).private)throw Error('Repository must remain private');
const directory=process.argv[2];if(!directory)throw Error('Pass the release output directory');fs.mkdirSync(directory,{recursive:true});
const name='QQARCFOX-'+version+'-source.zip',file=path.resolve(directory,name);
execFileSync('git',['archive','--format=zip','--prefix=QQARCFOX-'+version+'/','-o',file,tag],{cwd:root,windowsHide:true});
const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);const digest=hash.digest('hex');
const checksum=file+'.sha256';fs.writeFileSync(checksum,digest+'  '+name+'\n');console.log('Packaged '+name+' ('+fs.statSync(file).size+' bytes)');
let release;const response=await fetch(base+'/releases/tags/'+tag,{headers});
if(response.status===404)release=await api('/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:head,name:version,draft:true,prerelease:false,body:fs.readFileSync(path.join(root,'docs/releases/'+version+'.md'),'utf8')})});
else if(response.ok)release=await response.json();else throw Error('Cannot inspect release');
for(const assetFile of [file,checksum]){
 const assetName=path.basename(assetFile),existing=release.assets.find(a=>a.name===assetName);if(existing){if(existing.size!==fs.statSync(assetFile).size)throw Error('Existing asset size mismatch');continue;}
 console.log('Uploading '+assetName);const upload=release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(assetName);
 const result=await fetch(upload,{method:'POST',headers:{...headers,'Content-Type':assetFile===file?'application/zip':'text/plain'},body:await fs.openAsBlob(assetFile)});
 if(!result.ok)throw Error('Upload HTTP '+result.status);const asset=await result.json();if(asset.size!==fs.statSync(assetFile).size)throw Error('Uploaded size mismatch');
 if(assetFile===file&&asset.digest&&asset.digest!=='sha256:'+digest)throw Error('Uploaded hash mismatch');
}
const final=await api('/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false})});
console.log(JSON.stringify({url:final.html_url,tag:final.tag_name,head,draft:final.draft,sha256:digest,assets:final.assets.map(a=>({name:a.name,bytes:a.size,digest:a.digest}))},null,2));
