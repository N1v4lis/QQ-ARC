import bpy,json
from pathlib import Path
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root.parent/'Finish/Models/Blender/winefox-animated.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');mesh=bpy.data.objects['WineFox_Mesh']
for side in ('Left','Right'):
    group=mesh.vertex_groups[side+'ForeArm'].index;head=rig.data.bones[side+'ForeArm'].head_local;hand=rig.data.bones[side+'Hand'].head_local;u=(hand-head).normalized()
    coords=[v.co.copy() for v in mesh.data.vertices if any(g.group==group for g in v.groups)]
    print(side,'forearm length',(hand-head).length,'axialmax',max((v-head).dot(u) for v in coords),'wrist offset max',max((v-hand).dot(u) for v in coords))
    close=[v for v in coords if (v-hand).dot(u)>-.12]
    print('cuff perpendicular max',max(((v-hand)-u*(v-hand).dot(u)).length for v in close))
