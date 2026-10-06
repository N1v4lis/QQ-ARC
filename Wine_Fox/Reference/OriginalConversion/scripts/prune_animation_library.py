"""Create independent trimmed Blender and GLB libraries from the audited outputs."""
import json,struct,shutil
from pathlib import Path
root=Path(__file__).parent/'game-pack-conversion'
source=root/'openysm-checked'; output=root/'trimmed'
exact={'pre_parallel1','pre_parallel2','pre_parallel3','pre_parallel4',
       'parallel1','parallel5','ride','ride_pig','chair','gomoku'}
def remove(name): return name in exact or name.startswith(('vehicle','tac','carryon'))
model=json.loads((source/'game-pack-intermediate.bbmodel').read_text(encoding='utf-8'))
names=[a['name'] for a in model['animations']]
removed=[name for name in names if remove(name)]
output.mkdir(parents=True,exist_ok=True)
(output/'removal-request.json').write_text(json.dumps({'removed_source_names':removed,'all_source_names':names},ensure_ascii=False,indent=2),encoding='utf-8')
def trim_glb(path,target):
    raw=path.read_bytes(); length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    gltf=json.loads(raw[20:20+length]); binary=raw[28+length:]
    before=gltf['animations']; gltf['animations']=[a for a in before if not remove(a['name'])]
    references=[]
    def ref(obj,key):
        if key in obj: references.append((obj,key))
    for mesh in gltf.get('meshes',[]):
        for primitive in mesh['primitives']:
            ref(primitive,'indices')
            for key in primitive['attributes']: ref(primitive['attributes'],key)
            for target_attributes in primitive.get('targets',[]):
                for key in target_attributes: ref(target_attributes,key)
    for skin in gltf.get('skins',[]): ref(skin,'inverseBindMatrices')
    for animation in gltf['animations']:
        for sampler in animation['samplers']: ref(sampler,'input'); ref(sampler,'output')
    used=sorted({obj[key] for obj,key in references}); remap={old:new for new,old in enumerate(used)}
    gltf['accessors']=[gltf['accessors'][i] for i in used]
    for obj,key in references: obj[key]=remap[obj[key]]
    view_refs=[]
    for accessor in gltf['accessors']:
        assert 'sparse' not in accessor
        if 'bufferView' in accessor: view_refs.append((accessor,'bufferView'))
    for image in gltf.get('images',[]):
        if 'bufferView' in image: view_refs.append((image,'bufferView'))
    views=sorted({obj[key] for obj,key in view_refs}); remap={old:new for new,old in enumerate(views)}
    compact=bytearray(); new_views=[]
    for i in views:
        view=gltf['bufferViews'][i].copy(); start=view.get('byteOffset',0)
        compact.extend(b'\0'*((-len(compact))%4)); view['byteOffset']=len(compact)
        compact.extend(binary[start:start+view['byteLength']]); new_views.append(view)
    for obj,key in view_refs: obj[key]=remap[obj[key]]
    gltf['bufferViews']=new_views; gltf['buffers'][0]['byteLength']=len(compact)
    encoded=json.dumps(gltf,ensure_ascii=False,separators=(',',':')).encode()
    encoded+=b' '*((-len(encoded))%4); compact.extend(b'\0'*((-len(compact))%4))
    target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(compact))+
        struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
        struct.pack('<II',len(compact),0x004e4942)+compact)
    return {'file':str(target),'before':len(before),'after':len(gltf['animations']),
            'removed':[a['name'] for a in before if remove(a['name'])]}
records=[]
for variant in ('winefox','snowfox'):
    src=source/(variant+'-blender'); dst=output/(variant+'-blender'); dst.mkdir(exist_ok=True)
    records.append(trim_glb(src/(variant+'-animated.glb'),dst/(variant+'-animated.glb')))
    shutil.copy2(src/'SOURCE.txt',dst/'SOURCE.txt')
    report=json.loads((src/'animation-report.json').read_text(encoding='utf-8'))
    report['clips']=[c for c in report['clips'] if not remove(c['name'])]
    report['source_clips']=len(names)-len(removed); report['exported_clips']=records[-1]['after']
    report['removed_by_user_request']=removed
    (dst/'animation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(output/'glb-removal-report.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(records,ensure_ascii=False))
