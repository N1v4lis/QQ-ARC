import bpy,math,json,os
from pathlib import Path
from mathutils import Vector,Matrix,Euler,Quaternion
root=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'Finish/Models/Blender/winefox-animated.blend'))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
control=rig.data.edit_bones.new('Lever_Control');control.head=(0,.85,.52);control.tail=(0,.95,.52);control.use_deform=False
bpy.ops.object.mode_set(mode='OBJECT')
rig.animation_data.use_nla=False
idle=bpy.data.actions['idle'];rig.animation_data.action=idle;rig.animation_data.action_slot=idle.slots[0]
scene.frame_set(0);bpy.context.view_layer.update()
baseline={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
skirt_world=rig.pose.bones['clothe'].matrix.copy()
rig.animation_data.action=None
for b in rig.pose.bones:b.matrix_basis=baseline[b.name]
rig['表情']=0

def mat(name,color,metal=0):
    material=bpy.data.materials.new(name);material.diffuse_color=(*color,1);material.use_nodes=True
    shader=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if shader is None:
        shader=material.node_tree.nodes.new('ShaderNodeBsdfPrincipled');output=material.node_tree.nodes.new('ShaderNodeOutputMaterial');material.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])
    shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Metallic'].default_value=metal;shader.inputs['Roughness'].default_value=.45
    return material
iron=mat('Lever_DarkIron',(.055,.08,.10),.5);gold=mat('Lever_Brass',(.63,.36,.12),.65);red=mat('Lever_Grip',(.29,.045,.08));light=mat('Lever_Label',(.83,.70,.46));floor=mat('Floor',(.17,.19,.22))
prop_collection=bpy.data.collections.new('Large_Lever');scene.collection.children.link(prop_collection)
def move_prop(obj):
    for collection in list(obj.users_collection):collection.objects.unlink(obj)
    prop_collection.objects.link(obj)
def cube(name,location,scale,material,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1);obj=bpy.context.object;obj.name=name;obj.location=location;obj.scale=scale;obj.data.materials.append(material);move_prop(obj)
    if parent:obj.parent=parent
    bevel=obj.modifiers.new('Small edge bevel','BEVEL');bevel.width=.025;bevel.segments=2;obj.modifiers.new('Normals','WEIGHTED_NORMAL');return obj
def cylinder(name,location,radius,depth,material,parent=None,axis='Z'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=depth);obj=bpy.context.object;obj.name=name;obj.location=location;obj.data.materials.append(material);move_prop(obj)
    if axis=='X':obj.rotation_euler.y=math.pi/2
    if axis=='Y':obj.rotation_euler.x=math.pi/2
    if parent:obj.parent=parent
    return obj
pivot=bpy.data.objects.new('Lever_Pivot',None);prop_collection.objects.link(pivot);pivot.location=(0,.85,.52);pivot.empty_display_type='CIRCLE';pivot.empty_display_size=.12
cube('Lever_Base',(0,.85,.14),(1.15,.60,.28),iron)
cube('Lever_Support',(0,.85,.35),(.34,.32,.35),iron)
cylinder('Lever_Axle',(0,.85,.52),.13,.48,gold,axis='Y')
cylinder('Lever_Shaft',(0,0,.57),.072,1.14,gold,pivot)
cylinder('Lever_Handle',(0,0,1.15),.055,.80,red,pivot,axis='X')
for x in (-.42,.42):cylinder('Grip_Endcap',(x,0,1.15),.066,.065,gold,pivot,axis='X')
for x in (-.44,.44):
    cube('Travel_Stop',(x,.85,.34),(.10,.20,.12),gold)
    cylinder('Base_Bolt',(x,1.07,.29),.032,.032,light)
cube('Studio_Floor',(0,0,-.035),(200,200,.06),floor)

rest={n:rig.data.bones[n].matrix_local.copy() for n in ('LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand')}
segments={}
for side in ('Left','Right'):
    a=rig.data.bones[side+'Arm'].head_local;b=rig.data.bones[side+'ForeArm'].head_local;c=rig.data.bones[side+'Hand'].head_local
    segments[side]=(b-a,c-b)
def orient(name,point,old_direction,new_direction,hang_sleeve=False):
    q=old_direction.normalized().rotation_difference(new_direction.normalized()) @ rest[name].to_quaternion()
    if hang_sleeve:
        axis=new_direction.normalized();delta=q @ rest[name].to_quaternion().inverted()
        wing=delta @ Vector((1 if name.startswith('Left') else -1,0,0));wing=(wing-axis*wing.dot(axis)).normalized()
        down=Vector((0,0,-1));down=(down-axis*down.dot(axis)).normalized()
        angle=math.atan2(axis.dot(wing.cross(down)),wing.dot(down));q=Quaternion(axis,angle+math.radians(float(os.environ.get('LEVER_SLEEVE_ROLL','0')))) @ q
    rig.pose.bones[name].matrix=Matrix.Translation(point) @ q.to_matrix().to_4x4()
def solve_arm(side,target,shoulder):
    upper,fore=segments[side];l1=upper.length;l2=fore.length;delta=target-shoulder;distance=delta.length
    assert distance<l1+l2-.002,(side,distance,l1+l2)
    direction=delta.normalized();a=(l1*l1-l2*l2+distance*distance)/(2*distance);height=math.sqrt(max(0,l1*l1-a*a))
    lateral=float(os.environ.get('LEVER_ELBOW_X','1'));back=float(os.environ.get('LEVER_ELBOW_Y','.35'))
    hint=Vector((-lateral if side=='Left' else lateral,back,-.45));bend=(hint-direction*hint.dot(direction)).normalized();elbow=shoulder+direction*a+bend*height
    orient(side+'Arm',shoulder,upper,elbow-shoulder);bpy.context.view_layer.update()
    orient(side+'ForeArm',elbow,fore,target-elbow,hang_sleeve=True);bpy.context.view_layer.update()
    rig.pose.bones[side+'Hand'].matrix=Matrix.Translation(target) @ rig.pose.bones[side+'ForeArm'].matrix.to_quaternion().to_matrix().to_4x4()
    bpy.context.view_layer.update()
    return (rig.pose.bones[side+'Hand'].head-target).length

report=[]
for name,start,end in [('lever_left_to_right',16,-16),('lever_right_to_left',-16,16)]:
    rig_action=bpy.data.actions.new(name);rig_action.use_fake_user=True;rig.animation_data.action=rig_action
    pivot.animation_data_create();prop_action=bpy.data.actions.new(name+'_prop');prop_action.use_fake_user=True;pivot.animation_data.action=prop_action
    maximum_error=0
    for frame in range(21):
        scene.frame_set(frame)
        for b in rig.pose.bones:b.matrix_basis=baseline[b.name]
        t=max(0,min(1,(frame-2)/16));ease=t*t*(3-2*t);angle=start+(end-start)*ease;pivot.rotation_euler=(0,math.radians(angle),0)
        rig.pose.bones['Lever_Control'].rotation_mode='QUATERNION';rig.pose.bones['Lever_Control'].rotation_quaternion=Euler((0,math.radians(angle),0)).to_quaternion()
        bpy.context.view_layer.update()
        # Lean the upper body toward the handle while the feet stay planted.
        body=rig.pose.bones['UpBody'];matrix=body.matrix.copy();rotation=Euler((math.radians(-24),math.radians(angle*.90),0),'XYZ').to_quaternion()
        body.matrix=Matrix.Translation(matrix.translation) @ (rotation @ matrix.to_quaternion()).to_matrix().to_4x4();bpy.context.view_layer.update()
        # Counter the parent's lean: the skirt stays with the planted lower body.
        rig.pose.bones['clothe'].matrix=skirt_world
        bpy.context.view_layer.update()
        for side,x in [('Left',-.25),('Right',.25)]:
            shoulder=rig.pose.bones[side+'Arm'].head.copy()+Vector((-.075 if side=='Left' else .075,float(os.environ.get('LEVER_SHOULDER_Y','.10')),float(os.environ.get('LEVER_SHOULDER_Z','-.16'))))
            grip_normal=Vector((0,-1,0))
            normal=pivot.matrix_world.to_quaternion() @ grip_normal
            contact=pivot.matrix_world @ (Vector((x,0,1.15))+grip_normal*.055);support=.14
            for iteration in range(8):
                target=rig.matrix_world.inverted() @ (contact+normal*(support+.001))
                maximum_error=max(maximum_error,solve_arm(side,target,shoulder))
                delta=rig.pose.bones[side+'ForeArm'].matrix.to_quaternion() @ rest[side+'ForeArm'].to_quaternion().inverted()
                # Visible hands are 3-pixel cubes on ForeArm, not the transparent
                # 1-pixel placeholder on Hand. Use their actual rotated extent.
                cube_axes=[delta @ rest[side+'ForeArm'].to_quaternion() @ v for v in (Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))]
                support=.09375*sum(abs(v.dot(normal)) for v in cube_axes)
            rig.pose.bones[side+'Hand']['grip_support']=support
        # Track the lever with the head, without translating the model root.
        head=rig.pose.bones['Head'];head.rotation_mode='QUATERNION';head.rotation_quaternion=Euler((math.radians(18),math.radians(-angle*.10),math.radians(-angle*.12)),'XYZ').to_quaternion() @ baseline['Head'].to_quaternion()
        bpy.context.view_layer.update()
        for hair_name in ('LeftSideHair','RightSideHair','LongLeftHair','LongRightHair'):
            hair=rig.pose.bones[hair_name];matrix=hair.matrix.copy();rotation=Euler((math.radians(-32),math.radians(32 if 'Left' in hair_name else -32),0),'XYZ').to_quaternion()
            hair.matrix=Matrix.Translation(matrix.translation) @ (rotation @ matrix.to_quaternion()).to_matrix().to_4x4()
        # A travelling wave continues across the two clips: 0..pi, then pi..2pi.
        # Matching boundary phases prevent the tail from snapping on alternation.
        phase=math.pi*(frame/20+(0 if name=='lever_left_to_right' else 1))
        for index,tail_name in enumerate(('Tail','Tail2','Tail3','Tail4','Tail5','Tail6','Tail7')):
            tail=rig.pose.bones[tail_name];tail.rotation_mode='QUATERNION'
            lag=index*.28;sway=math.radians((28,7,9,8,6,5,3)[index])*math.sin(phase-lag)
            lift=math.radians(4 if index==0 else 2)*math.sin(2*phase-lag)
            tail.rotation_quaternion=baseline[tail_name].to_quaternion() @ Euler((lift,sway,0),'XYZ').to_quaternion()
        for ear_name,side in (('Left_ear',1),('Right_ear',-1)):
            ear=rig.pose.bones[ear_name];ear.rotation_mode='QUATERNION'
            ear.rotation_quaternion=baseline[ear_name].to_quaternion() @ Euler((math.radians(3)*math.sin(2*phase),math.radians(9*side)*math.sin(phase),math.radians(4*side)*math.sin(2*phase)),'XYZ').to_quaternion()
        for bone in rig.pose.bones:
            bone.rotation_mode='QUATERNION';bone.keyframe_insert(data_path='location',frame=frame,group=bone.name);bone.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=bone.name);bone.keyframe_insert(data_path='scale',frame=frame,group=bone.name)
        pivot.keyframe_insert(data_path='rotation_euler',frame=frame)
    report.append({'name':name,'lever_control_bone':'Lever_Control','frames':[0,20],'fps':30,'duration_seconds':20/30,'lever_angle_degrees':[start,end],'tail_phase':('0..pi' if start==16 else 'pi..2pi'),'maximum_hand_target_error':maximum_error})

scene.frame_start=0;scene.frame_end=math.ceil(max(a.frame_range[1] for a in bpy.data.actions));scene.render.fps=30;scene.use_preview_range=False
for action in bpy.data.actions:action.use_frame_range=False
def select_action(name):
    rig.animation_data.action=bpy.data.actions[name];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
    pivot.animation_data.action=bpy.data.actions[name+'_prop'];pivot.animation_data.action_slot=pivot.animation_data.action.slots[0]
select_action('lever_left_to_right');scene.frame_set(0)
pivot.animation_data_clear()
pivot.parent=rig;pivot.parent_type='BONE';pivot.parent_bone='Lever_Control';pivot.matrix_parent_inverse=Matrix.Translation((0,-.1,0));pivot.matrix_basis=Matrix.Identity(4)
for action_name in ('lever_left_to_right_prop','lever_right_to_left_prop'):
    bpy.data.actions.remove(bpy.data.actions[action_name])
for obj,action_suffix in ((rig,''),):
    obj.animation_data.action=None;obj.animation_data.use_nla=True
    for track in obj.animation_data.nla_tracks:track.mute=True
    for name in ('lever_left_to_right','lever_right_to_left'):
        track=obj.animation_data.nla_tracks.new();track.name=name;track.mute=name!='lever_left_to_right'
        strip=track.strips.new(name,0,bpy.data.actions[name+action_suffix]);strip.action_frame_start=0;strip.action_frame_end=20;strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
scene.frame_set(0);bpy.context.view_layer.update()
camera=scene.camera;camera.location=(3.1,5.2,2.7);target=Vector((0,.16,1.28));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.8
for obj in list(scene.objects):
    if obj.type=='LIGHT':bpy.data.objects.remove(obj,do_unlink=True)
for name,location,power,size in [('Key',(-3,4,6),650,5),('Fill',(3,1,4),400,4),('Rim',(0,-3,5),700,3)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=location;obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
scene.world.color=(.2,.2,.2);scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.resolution_x=960;scene.render.resolution_y=800;scene.render.resolution_percentage=100
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(root/'winefox-large-lever.blend'))
(root/'animation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
for direction in ('left_to_right','right_to_left'):
    for obj in (rig,):
        for track in obj.animation_data.nla_tracks:track.mute=track.name!='lever_'+direction
    for frame in (0,10,20):
        scene.frame_set(frame);scene.render.filepath=str(root/f'preview-{direction}-{frame:03}.png');bpy.ops.render.render(write_still=True)
print(report)
