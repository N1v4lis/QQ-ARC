"""Remove only the droplet cube in Expression_5; preserve textures and animations."""
import json,struct,shutil
from pathlib import Path
import numpy as np
root=Path(__file__).parent/'game-pack-conversion'; source=root/'trimmed'; out=root/'mouth-clean'
out.mkdir(exist_ok=True)
records=[]
for variant in ('winefox','snowfox'):
    path=source/(variant+'-blender')/(variant+'-animated.glb')
    raw=path.read_bytes(); length=struct.unpack_from('<I',raw,12)[0]
    g=json.loads(raw[20:20+length]); binary=bytearray(raw[28+length:])
    primitive=g['meshes'][0]['primitives'][0]; attributes=primitive['attributes']
    def array(index):
        a=g['accessors'][index]; v=g['bufferViews'][a['bufferView']]
        widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}; kinds={5126:'<f4',5123:'<u2',5125:'<u4'}
        return np.frombuffer(binary,dtype=kinds[a['componentType']],count=a['count']*widths[a['type']],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,widths[a['type']])
    uv=array(attributes['TEXCOORD_0']); joints=array(attributes['JOINTS_0'])
    expression=g['skins'][0]['joints'].index(next(i for i,n in enumerate(g['nodes']) if n.get('name')=='Expression_5'))
    starts=[]
    for start in range(0,len(uv),24):
        if joints[start,0]!=expression: continue
        # North face of the authored cube with box UV [144,61], size [1.3,1.575,2].
        if np.allclose(uv[start:start+4]*256,[[146,63],[147,63],[147,64],[146,64]]): starts.append(start)
    assert len(starts)==1,starts
    start=starts[0]; indices=array(primitive['indices']).flatten()
    triangles=indices.reshape(-1,3); mask=np.any((triangles>=start)&(triangles<start+24),axis=1)
    assert int(mask.sum())==12
    kept=triangles[~mask].flatten().copy(); del indices,triangles,uv,joints
    accessor=g['accessors'][primitive['indices']]; view=g['bufferViews'][accessor['bufferView']]
    offset=view['byteOffset']; payload=kept.tobytes()
    binary[offset:offset+len(payload)]=payload; view['byteLength']=len(payload); accessor['count']=len(kept)
    accessor.pop('min',None);accessor.pop('max',None)
    encoded=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    dst=out/(variant+'-blender');dst.mkdir(exist_ok=True)
    target=dst/path.name
    target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    shutil.copy2(source/(variant+'-blender')/'SOURCE.txt',dst/'SOURCE.txt')
    records.append({'file':str(target),'removed_bone':'Expression_5','removed_cube_uv':[144,61],
        'removed_triangles':12,'animations':len(g['animations']),'texture_unchanged':True})
(out/'removal-report.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(records))
