"""Bake Blockbench's bone clips into a glTF skin, using a fixed game-state profile."""
import bisect, collections, functools, json, math, re, struct, argparse, os, copy
import numpy as np
arguments=argparse.ArgumentParser()
arguments.add_argument('--output-dir')
arguments.add_argument('--source')
arguments.add_argument('--ground-speed',type=float,default=0.0)
arguments.add_argument('--openysm',action='store_true')
arguments.add_argument('--include-fox',action='store_true')
arguments.add_argument('--humanoid-fly-spin',action='store_true')
options=arguments.parse_args()
if options.output_dir: os.environ['WINEFOX_OUTPUT_DIR']=options.output_dir
if options.source: os.environ['WINEFOX_SOURCE']=options.source
if options.include_fox: os.environ['WINEFOX_INCLUDE_FOX']='1'
import convert_winefox as c
if options.humanoid_fly_spin:
    fly=next(a for a in c.m['animations'] if a['name']=='fly')
    rotor=next(an for an in fly['animators'].values() if an.get('name')=='wb')
    def find_group(nodes,name):
        for node in nodes:
            if not isinstance(node,dict): continue
            if node['name']==name: return node
            result=find_group(node.get('children',[]),name)
            if result: return result
    tail=find_group(c.m['outliner'],'MTail')
    tail_base=find_group(c.m['outliner'],'Tail')
    tail_outer=find_group(c.m['outliner'],'Tail2')
    base_cube=next(c.elements[ch] for ch in tail_base['children'] if isinstance(ch,str))
    # Anchor at the geometric far face of the fixed attachment segment,
    # before the parent's rest rotation. An identity intermediary preserves
    # all authored rest geometry and the entire first tail segment.
    anchor=[(base_cube['from'][i]+base_cube['to'][i])/2 for i in range(3)]
    anchor[2]=base_cube['to'][2]
    anchor=c.rotate(anchor,base_cube.get('origin',[0,0,0]),base_cube.get('rotation',[0,0,0]))
    human_fly_rotor_uid='f7d6a952-441d-4f51-986f-1853f0067765'
    spin_group={'name':'FlyTailRotor','uuid':human_fly_rotor_uid,'origin':anchor,
                'rotation':[0,0,0],'visibility':True,'children':[tail_outer]}
    tail_base['children']=[spin_group if ch is tail_outer else ch for ch in tail_base['children']]
    # Inverse of the Tail rest rotation maps the rearward world Z axis into
    # the rotor's parent coordinate system.
    r=tail_base.get('rotation') or [0,0,0]
    human_fly_spin_axis=c.rotate([0,0,1],[0,0,0],[-r[0],0,0])
    adapted=copy.deepcopy(rotor); adapted['name']='FlyTailRotor'
    for key in adapted['keyframes']:
        key['data_points'][0]['x']='0'
    fly['animators'][human_fly_rotor_uid]=adapted
    body=find_group(c.m['outliner'],'AllBody')
    fly['animators'][body['uuid']]['keyframes'][0]['data_points'][0]['x']='25'

FPS=30
DEFAULTS={'ysm.food_level':20,'ysm.has_mainhand':0,'ysm.has_offhand':0,
 'ysm.head_yaw':0,'ysm.head_pitch':0,'query.is_sneaking':0,
 'query.vertical_speed':0,'query.ground_speed':0,'query.head_x_rotation':0,
 'query.head_y_rotation':0,'v.player_size':1,'v.s':72,'v.f':1,'v.exp':0,
 'v.foxeye':0,'v.roaming.a':0}
unknown=set(); errors=set()
DEFAULTS['query.ground_speed']=options.ground_speed
TOKEN=re.compile(r'\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[A-Za-z_][\w.]*|\?\?|<=|>=|==|!=|&&|\|\||[+*/%()?:,;=<>!-])')
PRECEDENCE={'=':1,'??':2,'||':3,'&&':4,'==':5,'!=':5,'<':6,'>':6,'<=':6,'>=':6,'+':7,'-':7,'*':8,'/':8,'%':8}
@functools.lru_cache(None)
def parse(text):
    tokens=TOKEN.findall(text); i=0
    if ''.join(tokens) != re.sub(r'\s+','',text): raise ValueError('Unrecognized expression token')
    def expr(level=0):
        nonlocal i
        tok=tokens[i]; i+=1
        if tok in ('+','-','!'): left=('unary',tok,expr(9))
        elif tok=='(':
            left=expr(); assert tokens[i]==')'; i+=1
        elif tok[0].isdigit(): left=('num',float(tok))
        else:
            left=('var',tok)
            if i<len(tokens) and tokens[i]=='(':
                i+=1; args=[]
                if tokens[i]!=')':
                    while True:
                        args.append(expr())
                        if tokens[i]!=',': break
                        i+=1
                assert tokens[i]==')'; i+=1; left=('call',tok,args)
        while i<len(tokens):
            op=tokens[i]
            if op=='?' and level<=2:
                i+=1; yes=expr(2)
                if i<len(tokens) and tokens[i]==':': i+=1; no=expr(2)
                else: no=('num',0.0)
                left=('if',left,yes,no); continue
            rank=PRECEDENCE.get(op,-1)
            if rank<level: break
            i+=1; right=expr(rank if op=='=' else rank+1); left=('op',op,left,right)
        return left
    statements=[]
    while i<len(tokens):
        statements.append(expr())
        if i<len(tokens): assert tokens[i]==';'; i+=1
    return statements

def evaluate(text, env, default=0):
    try: return float(text)
    except (ValueError,TypeError): pass
    def visit(a):
        typ=a[0]
        if typ=='num': return a[1]
        if typ=='var':
            name=a[1].replace('q.','query.',1) if a[1].startswith('q.') else a[1]
            if name in ('true','false'): return float(name=='true')
            if name not in env: unknown.add(name)
            return env.get(name,0)
        if typ=='unary':
            x=visit(a[2]); return -x if a[1]=='-' else float(not x) if a[1]=='!' else x
        if typ=='if': return visit(a[2] if visit(a[1]) else a[3])
        if typ=='call':
            args=[visit(v) for v in a[2]]
            functions={'math.sin':lambda x:math.sin(math.radians(x)),
              'math.cos':lambda x:math.cos(math.radians(x)), 'math.exp':math.exp,
              'math.abs':abs,'math.sqrt':lambda x:math.sqrt(max(0,x)),
              'math.min':min,'math.max':max,'math.clamp':lambda x,l,h:max(l,min(h,x)),
              'math.lerp':lambda x,y,t:x+(y-x)*t}
            return functions[a[1]](*args)
        op=a[1]
        if op=='=':
            assert a[2][0]=='var'; env[a[2][1]]=visit(a[3]); return 0
        x=visit(a[2])
        if op=='??': return env.get(a[2][1],visit(a[3])) if a[2][0]=='var' else x
        if op=='&&': return float(bool(x) and bool(visit(a[3])))
        if op=='||': return float(bool(x) or bool(visit(a[3])))
        y=visit(a[3])
        return {'+':lambda:x+y,'-':lambda:x-y,'*':lambda:x*y,
         '/':lambda:x/y if y else 0,'%':lambda:x%y if y else 0,
         '<':lambda:float(x<y),'>':lambda:float(x>y),'<=':lambda:float(x<=y),
         '>=':lambda:float(x>=y),'==':lambda:float(x==y),'!=':lambda:float(x!=y)}[op]()
    try:
        value=0
        for statement in parse(str(text)): value=visit(statement)
        if not math.isfinite(value): raise ValueError('non-finite')
        return value
    except (ValueError,KeyError,AssertionError,IndexError,OverflowError) as exc:
        errors.add((str(text),str(exc))); return default

def quaternion(degrees):
    x,y,z=[math.radians(v)/2 for v in degrees]
    sx,cx=math.sin(x),math.cos(x); sy,cy=math.sin(y),math.cos(y); sz,cz=math.sin(z),math.cos(z)
    # THREE Euler ZYX: Rz * Ry * Rx.
    return [sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz]
def rotation_matrix(degrees):
    cols=[c.rotate([int(i==j) for i in range(3)],[0,0,0],degrees) for j in range(3)]
    return np.asarray(cols).T

nodes=[{'name':'WineFox_Armature','children':[]}]; groups={}; worlds={}; roots=[]
def build(ns,parent=0,parent_origin=(0,0,0),parent_world=None):
    if parent_world is None: parent_world=np.eye(4)
    for group in ns:
        if not isinstance(group,dict): continue
        idx=len(nodes); groups[group['uuid']]={'node':idx,'source':group}
        origin=group.get('origin',[0,0,0]); t=[(origin[i]-parent_origin[i])/16 for i in range(3)]
        rot=group.get('rotation') or [0,0,0]
        node={'name':group['name'],'translation':t,'rotation':quaternion(rot),'children':[]}
        nodes.append(node); nodes[parent]['children'].append(idx)
        local=np.eye(4); local[:3,:3]=rotation_matrix(rot); local[:3,3]=t
        world=parent_world@local; worlds[idx]=world
        build(group.get('children',[]),idx,origin,world)
build(c.m['outliner'])
fox_uid=next(uid for uid,entry in groups.items() if entry['source']['name']=='FOX')
body_uid=next(uid for uid,entry in groups.items() if entry['source']['name']=='AllBody')
if options.include_fox:
    # Default display hides the fox; inverse binds retain the authored geometry
    # coordinates so a scale of one restores it during the fly clip.
    nodes[groups[fox_uid]['node']]['scale']=[1e-5]*3
joint_nodes=list(range(1,len(nodes))); joint_lookup={node:i for i,node in enumerate(joint_nodes)}
# Rebuild the visible geometry while retaining a rigid joint weight per cube.
c.positions.clear(); c.normals.clear(); c.uvs.clear(); c.indices.clear()
joints=[]; original_add=c.add_cube
def add(e, ancestors):
    start=len(c.positions); original_add(e,ancestors)
    owner=groups[ancestors[-1]['uuid']]['node'] if ancestors else 1
    joints.extend([[joint_lookup[owner],0,0,0]]*(len(c.positions)-start))
c.add_cube=add; c.walk(c.m['outliner'])
c.blob.clear(); c.views.clear(); c.accessors.clear()
def acc(values,width,kind='f',component=5126,target=None,bounds=False,matrix=False):
    flat=[v for row in values for v in row] if width>1 else values
    view=c.buffer(struct.pack('<'+kind*len(flat),*flat),target)
    a={'bufferView':view,'componentType':component,'count':len(values),
       'type':'MAT4' if matrix else {1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'}[width]}
    if bounds:
        a['min']=[min(values)] if width==1 else [min(v[i] for v in values) for i in range(width)]
        a['max']=[max(values)] if width==1 else [max(v[i] for v in values) for i in range(width)]
    c.accessors.append(a); return len(c.accessors)-1
pa=acc(c.positions,3,target=34962,bounds=True); na=acc(c.normals,3,target=34962)
ua=acc(c.uvs,2,target=34962); ja=acc(joints,4,'H',5123,34962)
wa=acc([[1,0,0,0]]*len(joints),4,target=34962); ia=acc(c.indices,1,'I',5125,34963)
inverse=[np.linalg.inv(worlds[i]).flatten(order='F').tolist() for i in joint_nodes]
ib=acc(inverse,16,matrix=True)
g=c.g.copy(); g['nodes']=nodes
mesh_idx=len(nodes); nodes.append({'name':'WineFox_Mesh','mesh':0,'skin':0})
g['scenes']=[{'nodes':[0,mesh_idx]}]
g['skins']=[{'name':'WineFox_Rig','joints':joint_nodes,'inverseBindMatrices':ib,'skeleton':0}]
g['meshes']=[{'primitives':[{'attributes':{'POSITION':pa,'NORMAL':na,'TEXCOORD_0':ua,'JOINTS_0':ja,'WEIGHTS_0':wa},'indices':ia,'material':0}]}]
image_view=c.buffer(__import__('base64').b64decode(c.m['textures'][0]['source'].split(',',1)[1]))
g['images']=[{'bufferView':image_view,'mimeType':'image/png'}]

def sample(keys,time,env,channel,loop):
    default=1 if channel=='scale' else 0
    def value(key,pre=False):
        pt=key.get('pre_data_point',key['data_points'][0]) if pre else key['data_points'][0]
        return np.array([evaluate(pt.get(ax,default),env,default) for ax in ('x','y','z')])
    if len(keys)==1: return value(keys[0])
    times=[k['time'] for k in keys]; i=bisect.bisect_right(times,time)-1
    if i<0: return value(keys[0])
    if i>=len(keys)-1: return value(keys[-1])
    a,b=keys[i:i+2]; t=(time-a['time'])/(b['time']-a['time'])
    if a.get('interpolation')=='step': return value(a)
    p1,p2=value(a),value(b,pre=options.openysm)
    if a.get('interpolation')=='catmullrom' or b.get('interpolation')=='catmullrom':
        p0=value(keys[i-1] if i else keys[-2] if loop and len(keys)>=3 and not options.openysm else a)
        p3=value(keys[i+2] if i+2<len(keys) else keys[1] if loop and len(keys)>=3 and not options.openysm else b,pre=options.openysm)
        return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
    return p1+(p2-p1)*t

clips=[]; report=[]
for animation in c.m['animations']:
    clip_unknown_before=set(unknown); clip_errors_before=set(errors)
    name=animation['name']; tracks=[]; effects=[]; helper=[]; expr_count=0
    for uid,animator in animation.get('animators',{}).items():
        if animator.get('type')!='bone': effects.append(animator); continue
        if uid not in groups: continue
        channels=collections.defaultdict(list)
        for key in animator.get('keyframes',[]):
            if key['channel'] in ('rotation','position','scale'): channels[key['channel']].append(key)
        for channel,keys in channels.items():
            keys.sort(key=lambda k:k['time'])
            for key in keys:
                for val in key['data_points'][0].values():
                    try: float(val)
                    except (ValueError,TypeError): expr_count+=1
            track=(uid,channel,keys)
            if groups[uid]['source']['name'].startswith('molang'): helper.append(track)
            else: tracks.append(track)
    if options.include_fox and tracks:
        # Preserve the source fly rotations on wb; choose the matching form.
        # Other standalone clips remain in the default humanoid form.
        fox_fly=name=='fly' and not options.humanoid_fly_spin
        form_tracks={fox_uid:1 if fox_fly else 0,body_uid:0 if fox_fly else 1}
        tracks=[track for track in tracks if not (track[0] in form_tracks and track[1]=='scale')]
        for uid,scale in form_tracks.items():
            tracks.append((uid,'scale',[{'time':0,'interpolation':'linear',
                'data_points':[{'x':str(scale),'y':str(scale),'z':str(scale)}]}]))
    if not tracks:
        report.append({'name':name,'status':'no transform tracks','effect_animators':len(effects)})
        continue
    duration=max(float(animation.get('length',0)), max(k['time'] for _,_,keys in tracks for k in keys),1/FPS)
    # Bake curves at 30 fps, retaining exact source times and step discontinuities.
    times={0.0,duration}; times.update(min(i/FPS,duration) for i in range(math.ceil(duration*FPS)+1))
    for _,_,keys in tracks:
        times.update(k['time'] for k in keys)
        for key in keys:
            if key.get('pre_data_point') and key['pre_data_point']!=key['data_points'][0] and key['time']>0:
                times.add(max(0,key['time']-1e-5))
        for a,b in zip(keys,keys[1:]):
            if a.get('interpolation')=='step' and b['time']>0: times.add(max(0,b['time']-1e-5))
    times=sorted(times); ta=acc(times,1,bounds=True)
    values=[[] for _ in tracks]
    for time in times:
        env=DEFAULTS.copy(); env.update({'query.anim_time':time,'query.life_time':time,'query.time_stamp':time})
        for _,channel,keys in helper: sample(keys,time,env,channel,animation.get('loop')=='loop')
        for i,(uid,channel,keys) in enumerate(tracks):
            v=sample(keys,time,env,channel,animation.get('loop')=='loop')
            group=groups[uid]; rest=nodes[group['node']]
            if channel=='rotation':
                # bbmodel 4.10 stores Bedrock animation values. Blockbench 4.x
                # displayRotation negates animation X/Y, leaving rest angles intact.
                if options.humanoid_fly_spin and name=='fly' and uid==human_fly_rotor_uid:
                    angle=math.radians(v[2])/2
                    v=[component*math.sin(angle) for component in human_fly_spin_axis]+[math.cos(angle)]
                else:
                    v=quaternion(v*np.array([-1,-1,1])+np.array(group['source'].get('rotation') or [0,0,0]))
                if values[i] and np.dot(v,values[i][-1])<0: v=[-x for x in v]
            elif channel=='position': v=(v*np.array([-1,1,1])/16+np.array(rest['translation'])).tolist()
            else: v=np.maximum(v,1e-5).tolist()
            values[i].append(v)
    clip={'name':name,'samplers':[],'channels':[], 'extras':{'loop':animation.get('loop'),'sourceLength':animation.get('length'), 'bakedFPS':FPS}}
    for (uid,channel,keys),data in zip(tracks,values):
        width=4 if channel=='rotation' else 3
        output=acc(data,width)
        clip['channels'].append({'sampler':len(clip['samplers']),'target':{'node':groups[uid]['node'],'path':{'rotation':'rotation','position':'translation','scale':'scale'}[channel]}})
        clip['samplers'].append({'input':ta,'output':output,'interpolation':'LINEAR'})
    if options.openysm:
        # Standalone Blender Actions must explicitly reset untouched bones.
        # OpenYSM restores stopped channels; otherwise switching partial
        # Actions can retain the previous Action's pose or scale in Blender.
        keyed={(ch['target']['node'],ch['target']['path']) for ch in clip['channels']}
        rest_times=acc([0.0,duration],1,bounds=True)
        for node_index in joint_nodes:
            rest_node=nodes[node_index]
            for path,default_value in [('translation',[0,0,0]),('rotation',[0,0,0,1]),('scale',[1,1,1])]:
                if (node_index,path) in keyed: continue
                vector=rest_node.get(path,default_value)
                output=acc([vector,vector],len(vector))
                clip['channels'].append({'sampler':len(clip['samplers']),'target':{'node':node_index,'path':path}})
                clip['samplers'].append({'input':rest_times,'output':output,'interpolation':'LINEAR'})
        clip['extras']['standaloneCompletePose']=True
    clips.append(clip)
    report.append({'name':name,'status':'baked','duration':duration,'tracks':len(tracks),'samples':len(times),'expression_components':expr_count,'effect_animators':len(effects),
        'loop':animation.get('loop'),'timeline_events':len(animation.get('timeline',{})),
        'blend_weight':animation.get('blend_weight'),
        'new_unknown_variables':sorted(unknown-clip_unknown_before),
        'new_evaluation_errors':[{'expression':s,'error':e} for s,e in sorted(errors-clip_errors_before)]})
    print(name,len(tracks),len(times),flush=True)
for node in nodes:
    if node.get('children') == []: del node['children']
g['animations']=clips; g['bufferViews']=c.views; g['accessors']=c.accessors; g['buffers']=[{'byteLength':len(c.blob)}]
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode(); j+=b' '*((-len(j))%4)
c.blob+=b'\0'*((-len(c.blob))%4)
data=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(c.blob))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(c.blob),0x004e4942)+c.blob
target=c.OUT/'winefox-animated.glb'; target.write_bytes(data)
summary={'humanoid_fly_tail_spin':options.humanoid_fly_spin,
 'fox_form_included':options.include_fox,'fly_form':'FOX' if options.include_fox and not options.humanoid_fly_spin else 'humanoid',
 'coordinate_conversion':'Blockbench 4.x Bedrock: animation rotation (-X,-Y,+Z); translation (-X,+Y,+Z)',
 'source_clips':len(c.m['animations']),'exported_clips':len(clips),'joints':len(joint_nodes),
 'fps':FPS,'defaults':DEFAULTS,'unknown_variables_defaulted_to_zero':sorted(unknown),
 'evaluation_errors':[{'expression':s,'error':e} for s,e in sorted(errors)],'clips':report,
 'limitations':['Clips exported independently; Minecraft animation controllers and layered blending are not recreated.',
 'Expressions baked under fixed state; unprovided procedural v.* variables default to zero.',
 'Sounds, particles and event scripts are recorded but not exported.',
    'Catmull-Rom curves sampled at 30 fps; '+('OpenYSM endpoint clamping and pre/post evaluation.' if options.openysm else 'legacy loop endpoint treatment.'),
 'Scale zero is clamped to 0.00001, matching Blockbench preview.',
    'Blender import and visual rendering have not yet been verified.']}
if options.openysm: summary['limitations'].append('Each standalone clip explicitly restores untouched bone channels to rest; game transition timing and layered composition are not reproduced.')
(c.OUT/'animation-report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'file':str(target),'bytes':len(data),'clips':len(clips),'joints':len(joint_nodes),'errors':len(errors)}))
