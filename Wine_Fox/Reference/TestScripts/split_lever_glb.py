import json,struct
from pathlib import Path
root=Path(__file__).parent;data=(root/'winefox-large-lever.glb').read_bytes();size=struct.unpack_from('<I',data,12)[0];source=json.loads(data[20:20+size]);binary=data[28+size:]
for direction in ('left_to_right','right_to_left'):
    gltf=json.loads(json.dumps(source));gltf['animations']=[a for a in source['animations'] if a['name']=='lever_'+direction];assert len(gltf['animations'])==1
    encoded=json.dumps(gltf,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    (root/('winefox-lever-'+direction.replace('_','-')+'.glb')).write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
for direction in ('left_to_right','right_to_left','both'):
    directions=('left_to_right','right_to_left') if direction=='both' else (direction,)
    entries=[f"file 'frames/{d}-{f:03}.png'\nduration {1/15}\n" for d in directions for f in range(0,30,2)]
    last=directions[-1];entries.append(f"file 'frames/{last}-030.png'\n")
    filename='preview-frames.txt' if direction=='both' else f'preview-{direction}-frames.txt'
    (root/filename).write_text(''.join(entries),encoding='utf-8')
