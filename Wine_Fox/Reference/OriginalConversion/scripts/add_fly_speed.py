import bpy, math, json, argparse, sys
from pathlib import Path
from mathutils import Quaternion
arguments=argparse.ArgumentParser(); arguments.add_argument('--root',default=str(Path(__file__).parent))
options=arguments.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []); root=Path(options.root)

def fly_rig():
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    for track in rig.animation_data.nla_tracks: track.mute=True
    action=next(a for a in bpy.data.actions if a.name=='fly' or a.name.startswith('fly_'))
    rig.animation_data.action=action
    if len(action.slots): rig.animation_data.action_slot=action.slots[0]
    bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
    return rig

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps=30
bpy.ops.import_scene.gltf(filepath=str(root/'speed-reference'/'winefox-animated.glb'))
reference_rig=fly_rig()
reference=reference_rig.pose.bones['AllBody'].matrix_basis.to_quaternion().copy()
reference_world={name:reference_rig.pose.bones[name].matrix.to_quaternion().copy() for name in ('AllBody','Head','Tail')}
results=[]
for variant in ('winefox','snowfox'):
    folder=root/(variant+'-blender')
    bpy.ops.wm.open_mainfile(filepath=str(folder/(variant+'-animated.blend')))
    rig=fly_rig(); bone=rig.pose.bones['AllBody']
    original=bone.matrix_basis.to_quaternion().copy()
    delta=original.inverted() @ reference
    if delta.w<0: delta.negate()
    axis,angle=delta.to_axis_angle()
    assert abs(math.degrees(angle)-30)<0.01
    helper=bpy.data.objects.new('Fly_speed_rotation',None)
    bpy.context.collection.objects.link(helper)
    helper.rotation_mode='QUATERNION'; helper.hide_render=True
    helper.empty_display_size=0.01
    control=bpy.data.objects.new('飞行控制器',None)
    bpy.context.collection.objects.link(control)
    control.empty_display_size=0.01; control.hide_render=True
    control['飞行速度']=0.0
    control.id_properties_ui('飞行速度').update(min=0,max=20,soft_min=0,soft_max=20,
        description='原始 query.ground_speed：身体额外前倾=clamp(速度×1.5,0,30)度；不会改变尾巴转速或移动位置')
    control['启用飞行速度']=True; control.update_tag()
    control.id_properties_ui('启用飞行速度').update(description='使用 fly 时启用；切换其他动作前关闭，避免附加倾斜')
    for component in range(4):
        curve=helper.driver_add('rotation_quaternion',component)
        driver=curve.driver; driver.type='SCRIPTED'
        variable=driver.variables.new(); variable.name='speed'; variable.type='SINGLE_PROP'
        variable.targets[0].id=control; variable.targets[0].data_path='["飞行速度"]'
        half_angle='min(max(speed*1.5,0),30)*pi/360'
        driver.expression=('cos('+half_angle+')') if component==0 else repr(float(axis[component-1]))+'*sin('+half_angle+')'
    constraint=bone.constraints.new('COPY_ROTATION'); constraint.name='原始 fly 速度倾斜'
    constraint.target=helper; constraint.target_space='WORLD'; constraint.owner_space='LOCAL'
    constraint.mix_mode='AFTER'
    driver=constraint.driver_add('influence').driver
    driver.expression='enabled'
    variable=driver.variables.new(); variable.name='enabled'; variable.type='SINGLE_PROP'
    variable.targets[0].id=control; variable.targets[0].data_path='["启用飞行速度"]'
    samples=[]
    for speed in (0,10,20):
        control['飞行速度']=float(speed); control.update_tag(); helper.update_tag(); rig.update_tag(refresh={'OBJECT','DATA','TIME'}); rig.data.update_tag()
        bpy.context.scene.frame_set(1); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
        rotation=rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones['AllBody'].matrix.to_quaternion()
        if speed==0: start_rotation=rotation.copy()
        measured=math.degrees(start_rotation.rotation_difference(rotation).angle)
        assert abs(measured-speed*1.5)<0.02,(speed,measured)
        if speed==20:
            for name,expected in reference_world.items():
                actual=rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones[name].matrix.to_quaternion()
                assert abs(expected.dot(actual))>0.99999,(name,expected,actual)
        samples.append({'speed':speed,'additional_pitch_degrees':measured})
    control['启用飞行速度']=False; control.update_tag(); bpy.context.scene.frame_set(1); bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    actual=rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones['AllBody'].matrix.to_quaternion()
    assert abs(start_rotation.dot(actual))>0.99999
    control['启用飞行速度']=True
    control['飞行速度']=0.0; control.keyframe_insert(data_path='["飞行速度"]',frame=0)
    control['飞行速度']=20.0; control.keyframe_insert(data_path='["飞行速度"]',frame=20)
    for slot in control.animation_data.action.slots:
        for layer in control.animation_data.action.layers:
            for strip in layer.strips:
                bag=strip.channelbag(slot)
                if bag:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points: key.interpolation='LINEAR'
    bpy.context.scene.frame_set(10); bpy.context.view_layer.update()
    assert abs(control['飞行速度']-10)<0.001
    actual=rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones['AllBody'].matrix.to_quaternion()
    control['启用飞行速度']=False; control.update_tag()
    bpy.context.scene.frame_set(11); bpy.context.scene.frame_set(10); bpy.context.view_layer.update()
    baseline=rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones['AllBody'].matrix.to_quaternion()
    assert abs(math.degrees(baseline.rotation_difference(actual).angle)-15)<0.02
    control.animation_data_clear()
    control['启用飞行速度']=True; control.update_tag()
    control['飞行速度']=0.0; control.update_tag(); bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    for obj in bpy.context.selected_objects: obj.select_set(False)
    control.select_set(True); bpy.context.view_layer.objects.active=control
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='PROPERTIES': area.spaces.active.context='OBJECT'
    output=folder/(variant+'-fly-speed.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    results.append({'file':str(output),'samples':samples,'source_maximum_degrees':30,
        'matches_speed_20_source_bake':True,'disable_restores_original_pose':True,'keyframe_playback_verified':True})
(root/'fly-speed-verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
