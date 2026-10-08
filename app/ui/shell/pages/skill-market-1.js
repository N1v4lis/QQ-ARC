
const API='/api/community';let items=[],cat='all',me=null;
const $=s=>document.querySelector(s);function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';setTimeout(()=>e.style.display='none',2600)}

/* ── 账号系统：token 存 localStorage，右上角登录/注册 ── */
const TOKEN_KEY='qqa-market-token';
function savedToken(){return localStorage.getItem(TOKEN_KEY)||''}
async function refreshMe(){
  const t=savedToken();me=null;
  if(t){try{const d=await fetch(API+'/auth/whoami',{headers:{'X-Account-Token':t}}).then(r=>r.json());if(d.ok)me=d.account}catch(e){}}
  renderAuth();
}
function renderAuth(){
  const box=$('#authbox');
  if(!box)return;
  box.innerHTML=me
    ?`<span>👤 <span class="who">${esc(me.displayName||me.username||me.loginId)}</span></span><button class="pill" id="logout-btn">登出</button>`
    :`<button class="pill" id="login-btn">登录 / 注册</button>`;
  const lb=$('#login-btn');if(lb)lb.onclick=()=>openAuthModal('login');
  const ob=$('#logout-btn');if(ob)ob.onclick=()=>{localStorage.removeItem(TOKEN_KEY);me=null;renderAuth();toast('已登出')};
}
let authMode='login';
function openAuthModal(mode){
  authMode=mode;const m=$('#authModal');const isLogin=mode==='login';
  $('#amTitle').textContent=isLogin?'登录 QQ Agent 账号':'注册 QQ Agent 账号';
  $('#amDispRow').style.display=isLogin?'none':'';
  $('#amPass2Row').style.display=isLogin?'none':'';
  $('#amPassLabel').textContent=isLogin?'密码':'设置密码（6~72 位）';
  $('#amSwitch').textContent=isLogin?'没有账号？在这里注册':'已有账号？在这里登录';
  $('#amGo').textContent=isLogin?'确认登录':'确认注册';
  $('#amErr').textContent='';$('#amPassword').value='';$('#amPassword2').value='';
  m.classList.add('open');setTimeout(()=>$('#amLoginId').focus(),60);
}
$('#amSwitch').onclick=()=>openAuthModal(authMode==='login'?'register':'login');
$('#amCancel').onclick=()=>$('#authModal').classList.remove('open');
$('#authModal').onclick=e=>{if(e.target===$('#authModal'))$('#authModal').classList.remove('open')};
async function doAuth(){
  const loginId=$('#amLoginId').value.trim(),password=$('#amPassword').value;
  const displayName=$('#amDisplayName').value.trim(),password2=$('#amPassword2').value;
  const err=$('#amErr');err.textContent='';
  if(!loginId||!password){err.textContent='登录 ID 和密码都要填';return}
  if(authMode==='register'){
    if(!displayName){err.textContent='展示用户名不能为空';return}
    if(password!==password2){err.textContent='两次输入的密码不一致';return}
  }
  const btn=$('#amGo');btn.disabled=true;btn.textContent='处理中…';
  try{
    const body=authMode==='login'?{loginId,password}:{loginId,displayName,password};
    const r=await fetch(API+(authMode==='login'?'/auth/login':'/auth/register'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
    if(!r.ok)throw Error(r.error||'失败');
    localStorage.setItem(TOKEN_KEY,r.token);me=r.account;renderAuth();
    $('#authModal').classList.remove('open');
    toast((authMode==='login'?'登录成功，欢迎 ':'注册成功，欢迎 ')+(r.account.displayName||r.account.username));
  }catch(e){err.textContent=e.message}
  finally{btn.disabled=false;btn.textContent=authMode==='login'?'确认登录':'确认注册'}
}
$('#amGo').onclick=doAuth;
$('#amPassword').addEventListener('keydown',e=>{if(e.key==='Enter'&&authMode==='login')doAuth()});
$('#amPassword2').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth()});

function render(){const q=$('#search').value.trim().toLowerCase();const list=items.filter(x=>(cat==='all'||x.category===cat)&&(!q||`${x.name} ${x.description} ${x.id}`.toLowerCase().includes(q)));$('#grid').innerHTML=list.length?list.map(x=>`<article class="card"><div class="cardtop"><span class="badge">${esc(x.categoryName||x.category||'其他')}</span><span class="meta">v${esc(x.version||'0.0.0')}</span></div><h2>${esc(x.name||x.id)}</h2><p>${esc(x.description||'暂无描述')}</p><div class="meta"><span>${esc(x.author||'未声明作者')}</span><span>${esc(x.id)}</span></div><div class="actions">${x.downloadUrl?`<a class="btn" href="${esc(x.downloadUrl)}">下载 ZIP</a>`:''}${x.installCode?`<button class="btn code-btn" data-code="${esc(x.installCode)}">复制口令！</button>`:'<span class="meta" style="font-size:12px">待审核通过后开放下载</span>'}</div></article>`).join(''):'<div class="empty">没有匹配的 Skill</div>';
  document.querySelectorAll('[data-code]').forEach(b=>b.onclick=async()=>{await navigator.clipboard?.writeText(b.dataset.code||'');toast('口令已复制：'+b.dataset.code+' —— 到 QQ Agent 的「添加技能」里粘贴')});}
async function load(){try{const d=await fetch(API+'/skills').then(r=>r.json());items=(d.items||[]).map(x=>({...x,categoryName:(d.categories||{})[x.category]||x.category}));const cats=[['all','全部'],...Object.entries(d.categories||{})];$('#categories').innerHTML=cats.map(([k,v])=>`<button class="cat ${k===cat?'active':''}" data-cat="${esc(k)}">${esc(v)}</button>`).join('');document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;document.querySelectorAll('.cat').forEach(x=>x.classList.toggle('active',x===b));render()});render();}catch(e){$('#grid').innerHTML='<div class="empty">市场暂时无法连接，请稍后重试。</div>';}}
$('#search').oninput=render;
// 上传：点按钮 → 未登录先弹登录；已登录选文件直接传（走账号发布）
const upModal=$('#upModal');
function openUp(){
  if(!savedToken()){openAuthModal('login');toast('上传前请先登录账号');return}
  $('#upErr').textContent='';upModal.classList.add('open');
}
function closeUp(){upModal.classList.remove('open');}
$('#uploadBtn').onclick=openUp;
$('#upCancel').onclick=closeUp;
upModal.onclick=e=>{if(e.target===upModal)closeUp();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&upModal.classList.contains('open'))closeUp();});
$('#upSubmit').onclick=async()=>{
  const f=$('#upFile').files[0],errEl=$('#upErr');
  errEl.textContent='';
  if(!f){errEl.textContent='请选择 Skill 压缩包';return;}
  if(f.size>8*1024*1024){errEl.textContent='压缩包最大 8MB';return;}
  const btn=$('#upSubmit'),old=btn.textContent;btn.disabled=true;btn.textContent='上传中…';
  const fd=new FormData();fd.append('kind','skills');fd.append('file',f);
  try{
    const r=await fetch(API+'/market/publish',{method:'POST',headers:{'X-Account-Token':savedToken()},body:fd}).then(x=>x.json());
    if(!r.ok)throw Error(r.error||'上传失败');
    toast('已提交，审核通过后生成安装口令');
    closeUp();$('#upFile').value='';await load();
  }catch(e){errEl.textContent=e.message||'上传失败';}
  finally{btn.disabled=false;btn.textContent=old;}
};
refreshMe();load();
// 主题包未加载（本地预览）时启用兜底背景
addEventListener('load',()=>{if(!document.getElementById('th-flow-bg')&&!document.getElementById('th-canvas'))document.documentElement.classList.add('no-theme')});
