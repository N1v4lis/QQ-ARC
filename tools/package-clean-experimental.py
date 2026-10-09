import argparse,hashlib,json,shutil,subprocess,sys,zipfile
from pathlib import Path
from verify_clean_package import verify

# Asset generation/compilation belongs to build-experimental; this stage only packages.
def package(source,output):
    source=Path(source).resolve();output=Path(output).resolve()
    report=verify(source)
    output.mkdir(parents=True,exist_ok=True)
    destination=output/'RS0.1.0-First-Light'
    if source==destination:pass
    else:
        if destination.exists():
            # Refuse overwriting an installed app or user data. Previous staging must match our marker.
            if not (destination/'build-info.json').is_file():raise ValueError('Existing target is not a generated bundle')
            if destination.is_symlink() or destination.parent!=output:raise ValueError('Unsafe target path')
            if any(f.suffix in ['.db','.sqlite','.wal'] for f in destination.rglob('*')):raise ValueError('Target contains user data; will not overwrite')
            shutil.rmtree(destination)
        shutil.copytree(source,destination)
    manifest=[]
    for f in sorted(destination.rglob('*')):
        if f.is_file() and f.name not in ['package-manifest.json','verification.json']:
            manifest.append({'path':f.relative_to(destination).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    (destination/'package-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    (destination/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    archive=output/'RS0.1.0-First-Light-clean.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for f in sorted(destination.rglob('*')):
            if f.is_file():z.write(f,f.relative_to(destination).as_posix())
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n',encoding='ascii')
    return {'directory':str(destination),'archive':str(archive),'bytes':archive.stat().st_size,'sha256':digest,**report}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('bundle');p.add_argument('--output',required=True);a=p.parse_args();print(json.dumps(package(a.bundle,a.output),ensure_ascii=False,indent=2))
