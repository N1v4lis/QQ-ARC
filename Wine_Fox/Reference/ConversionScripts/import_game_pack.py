"""Read the user's Bedrock/YSM JSON pack into the converter's intermediate data."""
import base64,json,math,uuid,argparse
from pathlib import Path
root=Path(__file__).parent; pack=root/'01_taisho_maid'
arguments=argparse.ArgumentParser()
arguments.add_argument('--output-dir',default=str(root/'game-pack-conversion'))
options=arguments.parse_args()
out=Path(options.output_dir); out.mkdir(exist_ok=True,parents=True)
load=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
geo=load(pack/'models/main.json')['minecraft:geometry'][0]
def uid(name): return str(uuid.uuid5(uuid.NAMESPACE_URL,'ysm-game-pack:'+name))
def vec(value): return list(value) if isinstance(value,list) else [value]*3
def reflect(point): return [-point[0],point[1],point[2]]
def rotation(rot): return [-rot[0],-rot[1],rot[2]]
groups={}; elements=[]
for bone in geo['bones']:
    name=bone['name']
    group={'name':name,'uuid':uid(name),'origin':reflect(bone.get('pivot',[0,0,0])),
        'rotation':rotation(bone.get('rotation',[0,0,0])),'children':[],
        'visibility':name not in ('FOX','Backgrounds')}
    groups[name]=group
    for idx,cube in enumerate(bone.get('cubes',[])):
        origin=cube['origin']; size=cube['size']; x,y,z=size
        e={'name':name,'uuid':uid(f'{name}:cube:{idx}'),'type':'cube',
            'from':[-origin[0]-x,origin[1],origin[2]],
            'to':[-origin[0],origin[1]+y,origin[2]+z],
            'origin':reflect(cube.get('pivot',bone.get('pivot',[0,0,0]))),
            'rotation':rotation(cube.get('rotation',[0,0,0])),
            'inflate':cube.get('inflate',0),'faces':{}}
        uv=cube['uv']
        if isinstance(uv,list):
            u,v=uv; w,h,d=(math.floor(s+1e-8) for s in size)
            rects={'north':[u+d,v+d,u+d+w,v+d+h], 'east':[u,v+d,u+d,v+d+h],
             'west':[u+d+w,v+d,u+2*d+w,v+d+h], 'south':[u+2*d+w,v+d,u+2*d+2*w,v+d+h],
             'up':[u+d+w,v+d,u+d,v], 'down':[u+d+2*w,v,u+d+w,v+d]}
            if cube.get('mirror',bone.get('mirror',False)):
                rects['east'],rects['west']=rects['west'],rects['east']
                rects={face:[r[2],r[1],r[0],r[3]] for face,r in rects.items()}
            e['faces']={face:{'uv':r,'texture':0} for face,r in rects.items()}
        else:
            # Reflecting X exchanges east/west while preserving image content.
            for face,value in uv.items():
                u,v=value['uv']; du,dv=value.get('uv_size',[0,0])
                face={'east':'west','west':'east'}.get(face,face)
                e['faces'][face]={'uv':[u+du,v,u,v+dv],'texture':0}
        elements.append(e); group['children'].append(e['uuid'])
outliner=[]
for bone in geo['bones']:
    group=groups[bone['name']]
    if bone.get('parent') in groups: groups[bone['parent']]['children'].append(group)
    else: outliner.append(group)
textures=[]
for name in ('skin.png','skin_white.png'):
    textures.append({'name':name,'width':256,'height':256,'uv_width':256,'uv_height':256,
      'source':'data:image/png;base64,'+base64.b64encode((pack/'textures'/name).read_bytes()).decode()})
config=load(pack/'ysm.json'); animations=[]; seen=set(); ignored=[]
for label,file in config['files']['player']['animation'].items():
    for name,animation in load(pack/file)['animations'].items():
        if name in seen: ignored.append((file,name)); continue
        seen.add(name)
        result={'name':name,'length':animation.get('animation_length',0),
                'loop':'loop' if animation.get('loop') is True else 'hold' if animation.get('loop')=='hold_on_last_frame' else 'once',
                'timeline':animation.get('timeline',{}),'blend_weight':animation.get('blend_weight'),
                'source_file':file,'animators':{}}
        for bone,channels in animation.get('bones',{}).items():
            if bone not in groups: continue
            keys=[]
            for channel,value in channels.items():
                if channel not in ('position','rotation','scale'): continue
                items=value.items() if isinstance(value,dict) else [('0',value)]
                for time,payload in items:
                    time=float(time); interpolation='linear'
                    if isinstance(payload,dict):
                        interpolation=payload.get('lerp_mode','linear')
                        post=vec(payload.get('post',payload.get('pre',[0,0,0])))
                        pre=vec(payload.get('pre',post))
                    else: post=vec(payload)
                    key={'time':time,'channel':channel,'interpolation':interpolation,
                        'data_points':[dict(zip(('x','y','z'),map(str,post)))]}
                    if isinstance(payload,dict): key['pre_data_point']=dict(zip(('x','y','z'),map(str,pre)))
                    keys.append(key)
            result['animators'][uid(bone)]={'name':bone,'type':'bone','keyframes':keys}
        animations.append(result)
model={'meta':{'model_format':'bedrock','format_version':'4.10'},'name':'Game pack Wine Fox',
       'elements':elements,'outliner':outliner,'textures':textures,'animations':animations}
(out/'game-pack-intermediate.bbmodel').write_text(json.dumps(model,ensure_ascii=False),encoding='utf-8')
(out/'SOURCE.txt').write_text('Source: user-provided E:\\CodeX-YSM\\01_taisho_maid\n'
 'Geometry and animations: original package JSON, without manual tail motion or extra rotor bones.\n'
 'License: '+config['metadata']['license']['type']+'\n'
 'Authors: '+', '.join(a['name'] for a in config['metadata']['authors'])+'\n'
 'Runtime reference: https://github.com/OpenYSM/OpenYSM/tree/1.20.1-forge\n',encoding='utf-8')
print(json.dumps({'bones':len(groups),'cubes':len(elements),'animations':len(animations),'duplicate_names_skipped':ignored}))
