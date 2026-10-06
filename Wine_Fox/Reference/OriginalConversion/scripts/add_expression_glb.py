"""Expose authored neutral, smile, and angry expression geometry independently."""
import copy,json,struct
from pathlib import Path
import numpy as np

EXPRESSIONS={'Normal_Mouth':('Mouth_smile2',),'Happy_Mouth':('Expression_3',),'Anger_Mark':('Expression_7','Head_E_T_1_1','Head_E_T_1_2'),'Wave_Mouth':('Mouth_chill',),'Surprise_Mouth':('Mouth_surprise',),'Expression5_Mouth':('Expression_5',),'Expression6_Mouth':('Expression_6',)}
def build(source,target):
    raw=Path(source).read_bytes();size=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+size]);binary=bytearray(raw[28+size:]);p=g['meshes'][0]['primitives'][0]
    def array(index):
        a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        return np.frombuffer(binary,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']],count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,width).copy()
    joints=array(p['attributes']['JOINTS_0']);positions=array(p['attributes']['POSITION']);names=[g['nodes'][n]['name'] for n in g['skins'][0]['joints']]
    vertex_names=np.array([names[int(j)] for j in joints[:,0]])
    triangles=array(p['indices']).reshape(-1,3);component=g['accessors'][p['indices']]['componentType']
    facial=np.array([n.startswith('Mouth_') or n.startswith('Expression_') or n.startswith('Head_E_T_1_') for n in vertex_names]);body_mask=~facial[triangles].any(axis=1)
    def append(values,component,kind,target):
        binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);payload=values.tobytes();binary.extend(payload)
        view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(payload),'target':target})
        index=len(g['accessors']);g['accessors'].append({'bufferView':view,'componentType':component,'count':len(values),'type':kind});return index
    p['indices']=append(triangles[body_mask].flatten(),component,'SCALAR',34963)
    original=next(n for n in g['nodes'] if n.get('mesh')==0);original_id=g['nodes'].index(original)
    for mode,(name,bones) in enumerate(EXPRESSIONS.items()):
        selected=np.isin(vertex_names,bones);mask=selected[triangles].any(axis=1);assert mask.sum()>0
        primitive=copy.deepcopy(p);primitive['indices']=append(triangles[mask].flatten(),component,'SCALAR',34963)
        weights=joints.copy();weights[selected]=[names.index('Head'),0,0,0]
        primitive['attributes']['JOINTS_0']=append(weights,g['accessors'][p['attributes']['JOINTS_0']]['componentType'],'VEC4',34962)
        coords=positions.copy();coords[selected,2]-=1/16
        primitive['attributes']['POSITION']=append(coords,5126,'VEC3',34962);g['accessors'][primitive['attributes']['POSITION']].update(min=coords.min(axis=0).tolist(),max=coords.max(axis=0).tolist())
        mesh_id=len(g['meshes']);g['meshes'].append({'name':name,'primitives':[primitive]})
        node=copy.deepcopy(original);node.update(name=name,mesh=mesh_id,extras={'expressionMode':mode});node.pop('children',None)
        node_id=len(g['nodes']);g['nodes'].append(node)
        for scene in g['scenes']:
            if original_id in scene['nodes']:scene['nodes'].append(node_id)
    g['buffers'][0]['byteLength']=len(binary);encoded=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary.extend(b'\0'*((-len(binary))%4))
    Path(target).parent.mkdir(parents=True,exist_ok=True);Path(target).write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    print(target,'7 expressions, 44 animations')
if __name__=='__main__':
    build('game-pack-conversion/mouth-clean/winefox-blender/winefox-animated.glb','game-pack-conversion/expression-library/winefox-blender/winefox-animated.glb')
    build('winefox-web/dist/models/winefox.glb','winefox-web/dist/models/winefox-mouths.glb')
