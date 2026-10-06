import bpy,json
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=r'E:\CodeX-YSM\Finish\Models\Blender\winefox-animated.blend')
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
for n in ['Root','MRoot','AllBody','UpBody','UpperBody','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand']:
    b=rig.data.bones[n];print(n,'head',list(b.head_local),'tail',list(b.tail_local),'length',b.length,'matrix',list(b.matrix_local.to_quaternion()))
print('actions',[a.name for a in bpy.data.actions]);print('rig',rig.matrix_world)
