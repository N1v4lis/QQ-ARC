import argparse,hashlib,struct,subprocess,json
from pathlib import Path

def build(output,version):
    repo=Path(__file__).resolve().parent.parent;out=Path(output).resolve()
    series=json.loads((repo/'docs/rs-version-series.json').read_text(encoding='utf-8'))['series']
    item=next((s for s in series if s['version'].split('.')[:2]==version.split('.')[:2]),None)
    if item is None:raise ValueError('No approved codename for installer version')
    label='RS'+item['version']+'-'+item['codename'].replace(' ','-')
    archive=out/(label+'-clean.zip')
    if not archive.is_file():raise ValueError('Create and verify the clean ZIP first.')
    compiler=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    if not compiler.is_file():raise ValueError('Windows .NET Framework C# compiler unavailable')
    staging=repo/'_scratch/storage-installer-build';staging.mkdir(parents=True,exist_ok=True)
    exe=staging/'setup-stub.exe'
    source=(repo/'tools/windows-installer/FirstLightSetup.cs').read_text(encoding='utf-8-sig')
    for key,value in {'__RS_SERIES__':'RS'+'.'.join(item['version'].split('.')[:2]),'__CODENAME__':item['codename'],'__CODENAME_UPPER__':item['codename'].upper(),'__PHRASE__':item['phrase'],'__VERSION__':version}.items():source=source.replace(key,value)
    code=staging/'Setup.cs';code.write_text(source,encoding='utf-8-sig')
    args=[str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output', '/out:'+str(exe),'/win32icon:'+str(repo/'flutter/windows/runner/resources/app_icon.ico'),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll',str(code)]
    subprocess.run(args,check=True)
    target=out/('QQAF-'+label+'-Setup.exe')
    with target.open('wb') as f:
        f.write(exe.read_bytes());f.write(archive.read_bytes());f.write(struct.pack('<q',archive.stat().st_size));f.write(b'QQAFRS01')
    subprocess.run([str(target),'--verify'],check=True,timeout=90)
    digest=hashlib.sha256(target.read_bytes()).hexdigest();target.with_suffix('.exe.sha256').write_text(digest+'  '+target.name+'\n',encoding='ascii')
    print('Installer verified: '+str(target));print('SHA256: '+digest)
    return target
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--version',required=True);a=p.parse_args();build(a.output,a.version)
