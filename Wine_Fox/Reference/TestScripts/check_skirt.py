import bpy,json,collections
from pathlib import Path
from mathutils.bvhtree import BVHTree
root=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'Finish/Models/Blender/winefox-animated.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False;rig.animation_data.action=bpy.data.actions['idle'];rig.animation_data.action_slot=rig.animation_data.action.slots[0];bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
clothe_rest=rig.pose.bones['clothe'].matrix.copy()
def inspect():
    mesh=bpy.data.objects['WineFox_Mesh'];deps=bpy.context.evaluated_depsgraph_get();ev=mesh.evaluated_get(deps);verts=[ev.matrix_world@v.co for v in ev.data.vertices];groups={g.index:g.name for g in mesh.vertex_groups};labels={p.index:groups[mesh.data.vertices[p.vertices[0]].groups[0].group] for p in mesh.data.polygons}
    cloth_names={b.name for b in rig.pose.bones['clothe'].children_recursive}
    legs_names={b.name for b in rig.pose.bones['DownBody'].children_recursive}
    cp=[p for p in mesh.data.polygons if labels[p.index] in cloth_names];lp=[p for p in mesh.data.polygons if labels[p.index] in legs_names]
    ct=BVHTree.FromPolygons(verts,[list(p.vertices) for p in cp]);lt=BVHTree.FromPolygons(verts,[list(p.vertices) for p in lp]);pairs=ct.overlap(lt)
    return dict(collections.Counter(labels[cp[a].index]+' / '+labels[lp[b].index] for a,b in pairs))
print('SOURCE',inspect())
bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
for frame in (0,20,45,90,110,135):
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update();print('BEFORE',frame,inspect());rig.pose.bones['clothe'].matrix=clothe_rest;bpy.context.view_layer.update();print('AFTER',frame,inspect())
