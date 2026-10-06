"""Export the visible Blockbench rest pose to a self-contained glTF binary."""
import json, math, struct, base64, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('WINEFOX_SOURCE', str(ROOT / 'winefox-source' / '大正女仆酒狐.bbmodel')))
OUT = Path(os.environ.get('WINEFOX_OUTPUT_DIR', str(ROOT / 'winefox-blender')))
OUT.mkdir(exist_ok=True, parents=True)
m = json.loads(SOURCE.read_text(encoding='utf-8-sig'))
elements = {e['uuid']: e for e in m['elements']}
if os.environ.get('WINEFOX_INCLUDE_FOX') == '1':
    def enable_fox(nodes, inside=False):
        for node in nodes:
            if isinstance(node,dict):
                enabled=inside or node['name']=='FOX'
                if enabled: node['visibility']=True
                enable_fox(node.get('children',[]),enabled)
            elif inside and node in elements:
                elements[node]['visibility']=True
    enable_fox(m['outliner'])

def rotate(p, pivot, degrees):
    x,y,z = [p[i]-pivot[i] for i in range(3)]
    for axis, angle in enumerate(degrees):
        c,s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        if axis == 0: y,z = c*y-s*z,s*y+c*z
        elif axis == 1: x,z = c*x+s*z,-s*x+c*z
        else: x,y = c*x-s*y,s*x+c*y
    return [x+pivot[0],y+pivot[1],z+pivot[2]]

positions, uvs, normals, indices = [], [], [], []
def add_cube(e, ancestors):
    if e.get('visibility', True) is False: return
    inflate=e.get('inflate',0)
    a=[v-inflate for v in e['from']]; b=[v+inflate for v in e['to']]
    x,y,z=a; X,Y,Z=b
    # Each quad is outward-facing; UV starts at top-left as in Blockbench.
    quads={
      'north':[(X,Y,z),(x,Y,z),(x,y,z),(X,y,z)],
      'south':[(x,Y,Z),(X,Y,Z),(X,y,Z),(x,y,Z)],
      'east':[(X,Y,Z),(X,Y,z),(X,y,z),(X,y,Z)],
      'west':[(x,Y,z),(x,Y,Z),(x,y,Z),(x,y,z)],
      'up':[(x,Y,z),(X,Y,z),(X,Y,Z),(x,Y,Z)],
      'down':[(x,y,Z),(X,y,Z),(X,y,z),(x,y,z)]}
    for name, ps in quads.items():
        face=e['faces'].get(name,{})
        if face.get('texture') is None: continue
        pts=[]
        for p in ps:
            p=rotate(p,e.get('origin',[0,0,0]),e.get('rotation',[0,0,0]))
            for g in reversed(ancestors):
                p=rotate(p,g.get('origin',[0,0,0]),g.get('rotation') or [0,0,0])
            pts.append([v/16 for v in p])
        u0,v0,u1,v1=face['uv']
        tex=m['textures'][int(face['texture'])]
        w,h=tex.get('uv_width',256),tex.get('uv_height',256)
        coords=[(u0/w,v0/h),(u1/w,v0/h),(u1/w,v1/h),(u0/w,v1/h)]
        turns=int(face.get('rotation',0)//90)%4
        if turns: coords=coords[-turns:]+coords[:-turns]
        ab=[pts[1][i]-pts[0][i] for i in range(3)]
        ac=[pts[2][i]-pts[0][i] for i in range(3)]
        n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
        length=math.sqrt(sum(v*v for v in n))
        if length < 1e-12: continue
        n=[v/length for v in n]
        start=len(positions)
        positions.extend(pts); uvs.extend(coords); normals.extend([n]*4)
        indices.extend([start,start+1,start+2,start,start+2,start+3])

def walk(nodes, ancestors=()):
    for node in nodes:
        if isinstance(node,str):
            if node in elements: add_cube(elements[node],ancestors)
        elif node.get('visibility',True):
            walk(node.get('children',[]), ancestors+(node,))
walk(m['outliner'])

blob=bytearray(); views=[]; accessors=[]
def buffer(data, target=None):
    while len(blob)%4: blob.append(0)
    view={'buffer':0,'byteOffset':len(blob),'byteLength':len(data)}
    if target: view['target']=target
    views.append(view); blob.extend(data); return len(views)-1
def accessor(values, kind, width, component, target):
    flat=[v for row in values for v in row] if width>1 else values
    view=buffer(struct.pack('<'+kind*len(flat),*flat),target)
    a={'bufferView':view,'componentType':component,'count':len(values),'type':{1:'SCALAR',2:'VEC2',3:'VEC3'}[width]}
    if width==3:
        a['min']=[min(p[i] for p in values) for i in range(3)]
        a['max']=[max(p[i] for p in values) for i in range(3)]
    accessors.append(a); return len(accessors)-1
pa=accessor(positions,'f',3,5126,34962)
na=accessor(normals,'f',3,5126,34962)
ua=accessor(uvs,'f',2,5126,34962)
ia=accessor(indices,'I',1,5125,34963)
image_view=buffer(base64.b64decode(m['textures'][0]['source'].split(',',1)[1]))
g={'asset':{'version':'2.0','generator':'WineFox Blockbench static converter',
 'extras':{'source':'https://github.com/TartaricAcid/WineFoxModel','license':'CC BY-NC-SA 4.0; see upstream additional terms'}},
 'scene':0,'scenes':[{'nodes':[0]}], 'nodes':[{'name':'大正女仆酒狐','mesh':0}],
 'meshes':[{'primitives':[{'attributes':{'POSITION':pa,'NORMAL':na,'TEXCOORD_0':ua},'indices':ia,'material':0}]}],
 'materials':[{'name':'WineFox skin','doubleSided':True,'alphaMode':'MASK','alphaCutoff':0.5,
 'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':0.85}}],
 'textures':[{'source':0,'sampler':0}], 'samplers':[{'magFilter':9728,'minFilter':9728,'wrapS':33071,'wrapT':33071}],
 'images':[{'bufferView':image_view,'mimeType':'image/png'}], 'buffers':[{'byteLength':len(blob)}],
 'bufferViews':views,'accessors':accessors}
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode(); j+=b' '*((-len(j))%4)
blob+=b'\0'*((-len(blob))%4)
result=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(blob),0x004e4942)+blob
target=OUT/'winefox.glb'; target.write_bytes(result)
print(json.dumps({'file':str(target),'vertices':len(positions),'triangles':len(indices)//3,'bytes':len(result),'bounds':accessors[0]},ensure_ascii=False))
