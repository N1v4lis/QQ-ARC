import bpy,math,json
from pathlib import Path
from mathutils import Euler,Vector
root=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
source={}
for path in (root.parent/'01_taisho_maid/animations').rglob('*.json'):
    source.update(json.loads(path.read_text(encoding='utf-8-sig')).get('animations',{}))
audit=json.loads((root/'tail-audit-before.json').read_text(encoding='utf-8'))
moving={r['name'] for r in audit if r['moving']}
def curves(action):
    return action.layers[0].strips[0].channelbag(action.slots[0]).fcurves
fly_signature=[(c.data_path,c.array_index,[(tuple(k.co),k.interpolation) for k in c.keyframe_points]) for c in curves(bpy.data.actions['fly']) if c.data_path.startswith('pose.bones')]
rig.animation_data.use_nla=False
report=[]
# Source parallel3's L13 oscillator: F=2Hz, C=.8, R=20. Drive period=72/24=3s.
omega=2*math.pi/3;K1=.8/math.pi/2;K2=1/(2*math.pi*2)**2;K3=20*.8/(2*math.pi*2)
gain=K3/math.hypot(1-K2*omega*omega,K1*omega);lag=math.atan2(K1*omega,1-K2*omega*omega)
tail_params=[(5,0,10,1),(10,.3,4,1.1),(4,.5,6,1.3),(10,.6,3,1.5),(20,.6,0,0),(0,0,20,1.2)]
utility={'head:default','pre_parallel0'}
for action in list(bpy.data.actions):
    rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
    start,end=map(float,action.frame_range);raw=source.get(action.name,{})
    scene.frame_set(round(start));bpy.context.view_layer.update()
    bases={n:rig.pose.bones[n].rotation_quaternion.copy() for n in ('Tail','Tail2','Tail3','Tail4','Tail5','Tail6')}
    status='authored_motion_preserved' if action.name in moving else 'static'
    if action.name=='fly':status='excluded_fly'
    elif action.name in utility:status='utility_not_body_animation'
    elif action.name=='death':status='intentional_death_stillness_preserved'
    elif action.name not in moving:
        if end-start<=1.1 and raw.get('loop'):
            end=start+90
        factor=.08 if action.name=='sleep' else (.2 if action.name=='elytra_fly' else 1)
        duration=(end-start)/30
        drive_period=duration/max(1,round(duration/3)) if raw.get('loop') else 3
        drive_omega=2*math.pi/drive_period;drive_gain=K3/math.hypot(1-K2*drive_omega*drive_omega,K1*drive_omega);drive_lag=math.atan2(K1*drive_omega,1-K2*drive_omega*drive_omega)
        action['tail_loop_period_seconds']=drive_period
        # Keep the authored pose; compose only the absent procedural tail layer.
        sample_frames=sorted(set([start,end]+list(range(math.ceil(start),math.floor(end)+1))))
        for frame in sample_frames:
            time=(frame-start)/30
            for n,(ay,dy,az,dz) in zip(bases,tail_params):
                y=factor*drive_gain*ay*math.sin(drive_omega*(time-dy)-drive_lag);z=factor*drive_gain*az*math.sin(drive_omega*(time-dz)-drive_lag)
                rig.pose.bones[n].rotation_mode='QUATERNION';rig.pose.bones[n].rotation_quaternion=bases[n] @ Euler((0,math.radians(-y),math.radians(z)),'XYZ').to_quaternion()
                rig.pose.bones[n].keyframe_insert(data_path='rotation_quaternion',frame=frame,group=n)
        status='source_parallel_oscillator_baked'
    # Preserve all pose channel data in Fly; facial properties are independent.
    rig['自动表情']=0;rig['自动嘴巴']=0.0
    if not action.name.startswith('lever_'):
        control=rig.pose.bones['Lever_Control'];control.rotation_mode='QUATERNION';control.rotation_quaternion=(1,0,0,0);control.scale=(.00001,)*3
        for f in (start,end):
            control.keyframe_insert(data_path='rotation_quaternion',frame=f,group='Lever_Control');control.keyframe_insert(data_path='scale',frame=f,group='Lever_Control')
    def channel_value(data,time):
        if not isinstance(data,dict):return data
        keys=sorted((float(k),v) for k,v in data.items());previous=keys[0][1]
        for stamp,value in keys:
            if stamp>time:break
            previous=value
        if isinstance(previous,dict):previous=previous.get('post',previous.get('pre'))
        return previous
    def mode_at(time):
        if action.name in {'death','game_lost'}:return 6
        bones=raw.get('bones',{})
        for name,mode in [('Mouth_surprise',4),('Mouth_chill',3),('Mouth_smile',1)]:
            value=channel_value(bones.get(name,{}).get('position'),time)
            if isinstance(value,list) and isinstance(value[2],(int,float)) and value[2]<-.5:return mode
        for name,mode in [('Expression_7',2),('Expression_6',6),('Expression_5',5),('Expression_3',1)]:
            scale=channel_value(bones.get(name,{}).get('scale'),time)
            if scale==1 or isinstance(scale,list) and min(scale)>.5:return mode
        return 1 if action.name in {'beg','extra2','extra5','game_win'} else 0
    for frame in sorted(set([start,end]+list(range(math.ceil(start),math.floor(end)+1)))):
        mode=mode_at((frame-start)/30);rig['自动表情']=mode
        # Subtle mouth motion at a rate measured in seconds, not playback ticks.
        rig['自动嘴巴']=.2+.15*math.sin(2*math.pi*(frame-start)/30) if mode in (1,4,5) else .04*(1+math.sin(2*math.pi*(frame-start)/60))
        if action.name.startswith('lever_'):
            phase_frame=frame+(20 if action.name=='lever_right_to_left' else 0)
            rig['自动嘴巴']=.04*(1+math.sin(2*math.pi*phase_frame/40))
        rig.keyframe_insert(data_path='["自动表情"]',frame=frame,group='Face');rig.keyframe_insert(data_path='["自动嘴巴"]',frame=frame,group='Face')
    for c in curves(action):
        if c.data_path=='["自动表情"]':
            for k in c.keyframe_points:k.interpolation='CONSTANT'
    action.use_frame_range=False
    action['tail_repair']=status;action['original_source_loop']=str(raw.get('loop',False))
    report.append({'action':action.name,'tail_status':status,'range':[start,end],'auto_expression':True})
after=[(c.data_path,c.array_index,[(tuple(k.co),k.interpolation) for k in c.keyframe_points]) for c in curves(bpy.data.actions['fly']) if c.data_path.startswith('pose.bones') and 'Lever_Control' not in c.data_path]
assert after==fly_signature,'Fly source pose channels changed'
rig.animation_data.action=None;rig.animation_data.use_nla=True
expressions=['Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth']
rig['表情']=-1;rig['自动表情']=0;rig['嘴巴张合']=-1.0;rig['自动嘴巴']=0.0
rig.id_properties_ui('表情').update(min=-1,max=6,description='-1=跟随动作；0普通，1开心，2生气，3紧张，4惊讶，5小张嘴，6呆住')
rig.id_properties_ui('嘴巴张合').update(min=-1,max=1,description='-1跟随动作；0~1手动嘴巴张合，兼容所有动作')
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for mode in range(7):
    b=rig.data.edit_bones.new(f'FaceMode_{mode}');b.parent=rig.data.edit_bones['Head'];b.head=rig.data.edit_bones['Head'].head;b.tail=b.head+Vector((0,.1,0));b.use_deform=True
bpy.ops.object.mode_set(mode='OBJECT')
def property_var(driver,name,key):
    v=driver.variables.new();v.name=name;v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path='["'+key+'"]'
for mode,name in enumerate(expressions):
    obj=bpy.data.objects[name];obj['expressionMode']=mode;obj.vertex_groups.clear();g=obj.vertex_groups.new(name=f'FaceMode_{mode}');g.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    for prop in ('hide_viewport','hide_render'):
        d=obj.driver_add(prop).driver;d.expression=f'(round(manual) if manual>=0 else round(auto)) != {mode}'
        for v in list(d.variables):d.variables.remove(v)
        property_var(d,'manual','表情');property_var(d,'auto','自动表情')
    bone=rig.pose.bones[f'FaceMode_{mode}']
    for axis in range(3):
        d=bone.driver_add('scale',axis).driver;d.expression=f'1.0 if (round(manual) if manual>=0 else round(auto)) == {mode} else 0.00001'
        property_var(d,'manual','表情');property_var(d,'auto','自动表情')
    obj.shape_key_add(name='Basis');key=obj.shape_key_add(name='Mouth_Open')
    mouth_ids=[v.index for v in obj.data.vertices if v.co.z < rig.data.bones['Head'].head_local.z+.13]
    if mouth_ids:
        center=sum((obj.data.vertices[i].co for i in mouth_ids),Vector())/len(mouth_ids)
        for i in mouth_ids:key.data[i].co.z=center.z+(key.data[i].co.z-center.z)*1.35
    d=key.driver_add('value').driver;d.expression='max(0,min(1,manual if manual>=0 else auto))'
    property_var(d,'manual','嘴巴张合');property_var(d,'auto','自动嘴巴')
scene.use_preview_range=False;scene.frame_start=0;scene.frame_end=math.ceil(max(a.frame_range[1] for a in bpy.data.actions));scene.render.fps=30
for track in rig.animation_data.nla_tracks:
    track.mute=track.name!='lever_left_to_right'
    for strip in track.strips:
        strip.action_frame_end=strip.action.frame_range[1];strip.frame_end=strip.frame_start+(strip.action_frame_end-strip.action_frame_start);strip.extrapolation='HOLD_FORWARD'
scene.frame_set(0);bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(root/'winefox-large-lever.blend'))
# Snow Fox shares exactly the same geometry/actions/facial drivers, using the local pack's white skin.
white=bpy.data.images.load(str(root.parent/'01_taisho_maid/textures/skin_white.png'),check_existing=True);white.pack()
changed=0
for material in bpy.data.materials:
    if not material.use_nodes:continue
    for node in material.node_tree.nodes:
        if node.type=='TEX_IMAGE' and node.image and tuple(node.image.size)==(256,256):node.image=white;changed+=1
assert changed>0
rig.name='SnowFox_Armature';bpy.data.objects['WineFox_Mesh'].name='SnowFox_Mesh'
bpy.ops.wm.save_as_mainfile(filepath=str(root/'snowfox-large-lever.blend'))
(root/'library-enhancement-report.json').write_text(json.dumps({'oscillator_source':'01_taisho_maid/animations/main.animation.json:pre_parallel2+parallel3+parallel4','engine_source':'openysm-code/PlayerAnimationController.java','period_seconds':3,'gain':gain,'phase_lag':lag,'fly_original_pose_channels_preserved':True,'variants':['winefox','snowfox'],'actions':report,'playback_end':scene.frame_end,'preview_range':False,'gui_frames':[0,540],'fps':30},ensure_ascii=False,indent=2),encoding='utf-8')
print('ENHANCEMENT_OK',len(report),scene.frame_end,changed)
exec(compile((root/'fix_snow_mouth.py').read_text(encoding='utf-8'),str(root/'fix_snow_mouth.py'),'exec'))
