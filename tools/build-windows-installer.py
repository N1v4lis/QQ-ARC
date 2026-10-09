import argparse,hashlib,struct,subprocess
from pathlib import Path

def build(output):
    repo=Path(__file__).resolve().parent.parent;out=Path(output).resolve()
    archive=out/'RS0.1.0-First-Light-clean.zip'
    if not archive.is_file():raise ValueError('Create and verify the clean ZIP first.')
    compiler=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    if not compiler.is_file():raise ValueError('Windows .NET Framework C# compiler unavailable')
    staging=repo/'_scratch/storage-installer-build';staging.mkdir(parents=True,exist_ok=True)
    exe=staging/'setup-stub.exe'
    args=[str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output', '/out:'+str(exe),'/win32icon:'+str(repo/'flutter/windows/runner/resources/app_icon.ico'),'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll',str(repo/'tools/windows-installer/FirstLightSetup.cs')]
    subprocess.run(args,check=True)
    target=out/'QQAF-RS0.1.0-First-Light-Setup.exe'
    with target.open('wb') as f:
        f.write(exe.read_bytes());f.write(archive.read_bytes());f.write(struct.pack('<q',archive.stat().st_size));f.write(b'QQAFRS01')
    subprocess.run([str(target),'--verify'],check=True,timeout=90)
    digest=hashlib.sha256(target.read_bytes()).hexdigest();target.with_suffix('.exe.sha256').write_text(digest+'  '+target.name+'\n',encoding='ascii')
    print('Installer verified: '+str(target));print('SHA256: '+digest)
    return target
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();build(a.output)
