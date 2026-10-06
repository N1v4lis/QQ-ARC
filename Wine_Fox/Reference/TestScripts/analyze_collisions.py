import bpy,json,collections
from pathlib import Path
from mathutils.bvhtree import BVHTree
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');mesh=bpy.data.objects['WineFox_Mesh'];pivot=bpy.data.objects['Lever_Pivot'];deps=bpy.context.evaluated_depsgraph_get()
groups={g.index:g.name for g in mesh.vertex_groups}
face_groups={p.index:groups[mesh.data.vertices[p.vertices[0]].groups[0].group] for p in mesh.data.polygons}
arm_names={'LeftArm','RightArm','LeftForeArm','RightForeArm','LeftHand','RightHand'}
def tree(obj):
    ev=obj.evaluated_get(deps);data=ev.to_mesh();result=BVHTree.FromPolygons([ev.matrix_world@v.co for v in data.vertices],[list(p.vertices) for p in data.polygons]);ev.to_mesh_clear();return result
report=[]
for frame in (0,23,45,67,90):
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update();ev=mesh.evaluated_get(deps);vertices=[ev.matrix_world@v.co for v in ev.data.vertices]
    parts={};labels={}
    for label,names in [('left',{'LeftArm','LeftForeArm','LeftHand'}),('right',{'RightArm','RightForeArm','RightHand'}),('body',set(face_groups.values())-arm_names),('hands',{'LeftHand','RightHand'})]:
        polygons=[p for p in mesh.data.polygons if face_groups[p.index] in names];labels[label]=[face_groups[p.index] for p in polygons]
        parts[label]=BVHTree.FromPolygons(vertices,[list(p.vertices) for p in polygons])
    collision={}
    for name in ('Lever_Base','Lever_Support','Lever_Shaft','Lever_Handle'):
        prop=tree(bpy.data.objects[name]);collision[name]={part:len(t.overlap(prop)) for part,t in parts.items()}
        collision[name]['groups']={part:dict(collections.Counter(labels[part][a] for a,b in t.overlap(prop))) for part,t in parts.items()}
    collision['arms']={'left_body':len(parts['left'].overlap(parts['body'])),'right_body':len(parts['right'].overlap(parts['body'])),'left_right':len(parts['left'].overlap(parts['right']))}
    collision['body_parts']={side:dict(collections.Counter(labels['body'][b] for a,b in parts[side].overlap(parts['body']))) for side in ('left','right')}
    collision['arm_parts']={side:dict(collections.Counter(labels[side][a]+' / '+labels['body'][b] for a,b in parts[side].overlap(parts['body']))) for side in ('left','right')}
    report.append({'frame':frame,'collisions':collision})
(root/'collision-analysis.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(report)
