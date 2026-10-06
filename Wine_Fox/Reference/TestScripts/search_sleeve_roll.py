import bpy,math,json,textwrap,os
from pathlib import Path
from mathutils.bvhtree import BVHTree
root=Path(__file__).parent
source=(root/'create_lever_actions.py').read_text(encoding='utf-8')
exec(source.split('report=[]')[0])
mesh=bpy.data.objects['WineFox_Mesh'];deps=bpy.context.evaluated_depsgraph_get()
groups={g.index:g.name for g in mesh.vertex_groups}
faces={s:[list(p.vertices) for p in mesh.data.polygons if groups[mesh.data.vertices[p.vertices[0]].groups[0].group]==s+'ForeArm'] for s in ('Left','Right')}
block=textwrap.dedent(source.split('    for frame in range(91):\n')[1].split('        for bone in rig.pose.bones:')[0])
results=[]
for shoulder_y,shoulder_z,roll in [(y,z,r) for y in (0,.05,.10,.15) for z in (-.06,-.11,-.16) for r in (-15,0,15)]:
    os.environ['LEVER_SHOULDER_Y']=str(shoulder_y);os.environ['LEVER_SHOULDER_Z']=str(shoulder_z);os.environ['LEVER_SLEEVE_ROLL']=str(roll);counts=[]
    for pose_angle in (-16,0,16):
        start=end=pose_angle;frame=0;maximum_error=0;exec(block);bpy.context.view_layer.update()
        ev=mesh.evaluated_get(deps);verts=[ev.matrix_world@v.co for v in ev.data.vertices]
        props=[]
        for name in ('Lever_Handle','Lever_Shaft','Grip_Endcap','Grip_Endcap.001'):
            obj=bpy.data.objects[name];evp=obj.evaluated_get(deps);data=evp.to_mesh();props.append(BVHTree.FromPolygons([evp.matrix_world@v.co for v in data.vertices],[list(p.vertices) for p in data.polygons]));evp.to_mesh_clear()
        body=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if groups[mesh.data.vertices[p.vertices[0]].groups[0].group] not in {'LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'}])
        head_hair=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if groups[mesh.data.vertices[p.vertices[0]].groups[0].group] not in {'LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','UpperBody','UpBody'}])
        counts.append([sum(len(BVHTree.FromPolygons(verts,faces[s]).overlap(p)) for p in props+[body])+sum(len(BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if groups[mesh.data.vertices[p.vertices[0]].groups[0].group]==s+'Arm']).overlap(p)) for p in props+[head_hair]) for s in ('Left','Right')])
    results.append({'shoulder_y':shoulder_y,'shoulder_z':shoulder_z,'roll':roll,'counts':counts,'sum':sum(sum(c) for c in counts)})
results.sort(key=lambda x:x['sum']);print('ROLL_RESULTS',results)
(root/'sleeve-roll-search.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
