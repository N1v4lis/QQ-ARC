import bpy
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path(__file__).parent/'winefox-large-lever.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False;rig.animation_data.action=bpy.data.actions['attacked'];rig.animation_data.action_slot=rig.animation_data.action.slots[0];bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
for c in rig.animation_data.drivers:
 print(c.data_path,c.array_index,c.driver.expression,c.driver.is_valid,[(v.name,v.targets[0].data_path) for v in c.driver.variables])
print('props',rig['表情'],rig['自动表情']);print('raw',[(b.name,list(b.scale)) for b in rig.pose.bones if b.name.startswith('FaceMode')]);print('evaluated',[(b.name,list(b.scale)) for b in rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).pose.bones if b.name.startswith('FaceMode')])
