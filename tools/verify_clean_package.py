import argparse,hashlib,json,os,subprocess,tempfile,urllib.request,uuid
from pathlib import Path

# Runtime verification uses a temporary data directory, never the install/user profile.
def verify(bundle):
    bundle=Path(bundle).resolve()
    required=['qqaf.exe','qqaf-native.exe','flutter_windows.dll','data/app.so','data/icudtl.dat','data/flutter_assets/AssetManifest.bin']
    for name in required:
        if not (bundle/name).is_file():raise ValueError('Missing runtime file: '+name)
    # Old archive templates must not even be embedded in the clean executable.
    binary=(bundle/'qqaf-native.exe').read_bytes()
    old=json.loads((Path(__file__).resolve().parent.parent/'native/resources/default-config.json').read_text(encoding='utf-8'))
    body=old['persona']['roleText']
    if body[:80].encode('utf-8') in binary:raise ValueError('Archived default persona embedded in clean binary')
    assets=bundle/'data/flutter_assets/assets'
    for name in ['brand/qqaf-icon.svg']+[f'default-icons/{n}.svg' for n in [0,1,2,4,6,7,8,9,10,11,18]]:
        expected=Path(__file__).resolve().parent.parent/'app/ui/assets'/name
        actual=assets/name
        if not actual.is_file() or actual.read_bytes()!=expected.read_bytes():raise ValueError('Missing or stale packaged icon: '+name)
    forbidden=[]
    for f in bundle.rglob('*'):
        if f.is_symlink():raise ValueError('Package must not include symlinks: '+str(f))
        if not f.is_file():continue
        relative=f.relative_to(bundle)
        if f.suffix.lower() in ['.sqlite','.db','.wal','.shm','.log','.pdb','.env'] or any(p.lower() in ['accounts','cache','userdata','node_modules'] for p in relative.parts):forbidden.append(str(relative))
    if forbidden:raise ValueError('User data/debug files present: '+str(forbidden))
    repo=Path(__file__).resolve().parent.parent
    scratch=repo/'_scratch';scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='storage-clean-verification-',dir=scratch) as data:
        env=dict(os.environ)
        # Verify WITHOUT the previous runtime clean flag. The compiled feature is authoritative.
        env.pop('QQAF_CLEAN_DEFAULTS',None)
        token=uuid.uuid4().hex
        env['QQAF_CORE_TOKEN']=token;env['QQAF_NATIVE_DATA_DIR']=data
        child=subprocess.Popen([str(bundle/'qqaf-native.exe')],cwd=bundle,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8')
        def request(path,body=None):
            req=urllib.request.Request('http://127.0.0.1:'+str(port)+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
        try:
            from concurrent.futures import ThreadPoolExecutor
            pool=ThreadPoolExecutor(max_workers=1)
            try: first=pool.submit(child.stdout.readline).result(timeout=20)
            except Exception:
                child.kill()
                raise
            finally: pool.shutdown(wait=False)
            if not first:raise ValueError('Clean core did not start')
            port=json.loads(first)['port']
            status=request('/status')
            if status.get('clean_release') is not True:raise ValueError('Core was not compiled with clean-release feature')
            if request('/accounts')!=[]:raise ValueError('Fresh install has bundled accounts')
            library=request('/persona/templates')
            if library.get('builtin')!={} or library.get('custom')!=[]:raise ValueError('Fresh install has bundled personas')
            request('/accounts',{'account':'clean-verification'})
            cfg=request('/config?account=clean-verification')
            if cfg['providers'] or cfg['api']['apiKey'] or cfg['api']['model'] or cfg['api']['provider'] or cfg['api']['baseUrl']:raise ValueError('Fresh model configuration is not empty')
            if any(cfg['persona'].get(k) for k in ['botName','selfNickname','roleText','customRules','systemPromptOverride']):raise ValueError('Fresh persona is not empty')
            if cfg['personaByChat'] or cfg['runtime']['enabled'] or cfg['proxy']['enabled']:raise ValueError('Fresh configuration contains active user settings')
            if request('/chats?account=clean-verification') or request('/memory?account=clean-verification&chat=scratch') or request('/runs?account=clean-verification'):raise ValueError('Fresh store contains conversation records')
            request('/shutdown',{})
            child.wait(timeout=15)
        finally:
            if child.poll() is None:child.kill();child.wait(timeout=10)
    return {'verified':True,'files':sum(f.is_file() for f in bundle.rglob('*')),'cleanRelease':True,'initialAccounts':0,'initialProviders':0,'initialPersonas':0,'userDataFiles':0,'packagedNavigationIcons':11}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('bundle');args=p.parse_args()
    print(json.dumps(verify(args.bundle),ensure_ascii=False,indent=2))
