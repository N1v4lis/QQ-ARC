import bpy,json,struct
from pathlib import Path
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');pivot=bpy.data.objects['Lever_Pivot']
for obj,suffix in ((rig,''),):
    obj.animation_data.action=None;obj.animation_data.use_nla=True
    for track in list(obj.animation_data.nla_tracks):obj.animation_data.nla_tracks.remove(track)
    for name in ('lever_left_to_right','lever_right_to_left'):
        track=obj.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,0,bpy.data.actions[name+suffix]);strip.extrapolation='NOTHING'
expressions=['Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth']
for mode,name in enumerate(expressions):
    obj=bpy.data.objects[name]
    for prop in ('hide_viewport','hide_render'):obj.driver_remove(prop);setattr(obj,prop,False)
    obj['expressionMode']=mode
for obj in bpy.context.scene.objects:
    include=obj==rig or obj==pivot or (obj.type=='MESH' and obj.name not in ('Studio_Floor','Unused_Expressions'))
    obj.select_set(include)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(root/'winefox-large-lever.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_merge_animation='NLA_TRACK',export_frame_range=False,export_force_sampling=True,export_extras=True,export_cameras=False,export_lights=False)
data=(root/'winefox-large-lever.glb').read_bytes();size=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+size])
result={'animations':[],'expression_nodes':[n['name'] for n in g['nodes'] if 'expressionMode' in n.get('extras',{})]}
for animation in g['animations']:
    targets={g['nodes'][c['target']['node']]['name'] for c in animation['channels']}
    result['animations'].append({'name':animation['name'],'channels':len(animation['channels']),'lever_animated':'Lever_Control' in targets})
assert {a['name'] for a in g['animations']}=={'lever_left_to_right','lever_right_to_left'},result
assert all(a['lever_animated'] for a in result['animations']);assert len(result['expression_nodes'])==7
(root/'glb-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(result)
