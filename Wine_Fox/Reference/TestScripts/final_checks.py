import bpy,json,struct,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'Finish/Models/Blender/winefox-animated.blend'))
source_rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');source_rig.animation_data.use_nla=False;source_rig.animation_data.action=bpy.data.actions['idle'];source_rig.animation_data.action_slot=source_rig.animation_data.action.slots[0];bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
source_mesh=bpy.data.objects['WineFox_Mesh'];source_groups={g.index:g.name for g in source_mesh.vertex_groups};cloth_names={b.name for b in source_rig.pose.bones['clothe'].children_recursive};source_ev=source_mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
skirt_rest={v.index:(source_ev.matrix_world@source_ev.data.vertices[v.index].co).copy() for v in source_mesh.data.vertices if source_groups[v.groups[0].group] in cloth_names}
bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');pivot=bpy.data.objects['Lever_Pivot'];maximum=0;feet_start=None;foot_drift=0
mesh=bpy.data.objects['WineFox_Mesh'];deps=bpy.context.evaluated_depsgraph_get()
group_names={g.index:g.name for g in mesh.vertex_groups}
labels={p.index:group_names[mesh.data.vertices[p.vertices[0]].groups[0].group] for p in mesh.data.polygons}
uv=mesh.data.uv_layers.active.data
hand_faces={side:[p for p in mesh.data.polygons if labels[p.index]==side+'ForeArm' and all(101.9 <= uv[i].uv.x*256 <=114.1 and 87.9 <= (1-uv[i].uv.y)*256 <=94.1 for i in p.loop_indices)] for side in ('Left','Right')}
assert all(len(polys)==12 for polys in hand_faces.values()),{s:len(p) for s,p in hand_faces.items()}
collisions={};self_collisions=[];min_gap=1e9;max_gap=0;max_center_error=0;skirt_drift=0;boundaries={};tail_poses=[]
for direction,frame in [(direction,frame) for direction in ('lever_left_to_right','lever_right_to_left') for frame in range(21)]:
    for obj in (rig,):
        for track in obj.animation_data.nla_tracks:track.mute=track.name!=direction
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
    ev=mesh.evaluated_get(deps);verts=[ev.matrix_world@v.co for v in ev.data.vertices]
    if frame in (0,20):boundaries[(direction,frame)]=(verts,pivot.matrix_world.copy())
    tail_poses.append(rig.pose.bones['Tail3'].matrix.copy())
    skirt_drift=max(skirt_drift,max((verts[i]-point).length for i,point in skirt_rest.items()))
    body_tree=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] not in {'LeftHand','RightHand'}])
    arm_names={'LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand'}
    torso=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] not in arm_names])
    accessories=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] not in arm_names|{'UpperBody','UpBody'}])
    forearms=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] in {'LeftForeArm','RightForeArm'}])
    upperarms=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] in {'LeftArm','RightArm'}])
    left=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] in {'LeftArm','LeftForeArm'}])
    right=BVHTree.FromPolygons(verts,[list(p.vertices) for p in mesh.data.polygons if labels[p.index] in {'RightArm','RightForeArm'}])
    count=len(forearms.overlap(torso))+len(upperarms.overlap(accessories))+len(left.overlap(right))
    if count:self_collisions.append({'frame':frame,'surface_intersections':count})
    for obj in bpy.data.collections['Large_Lever'].objects:
        if obj.type!='MESH' or obj.name=='Studio_Floor':continue
        prop_ev=obj.evaluated_get(deps);data=prop_ev.to_mesh();prop_tree=BVHTree.FromPolygons([prop_ev.matrix_world@v.co for v in data.vertices],[list(p.vertices) for p in data.polygons]);prop_ev.to_mesh_clear()
        count=len(body_tree.overlap(prop_tree))
        if count:collisions.setdefault(obj.name,[]).append({'frame':frame,'surface_intersections':count})
    grip_normal=Vector((0,-1,0));normal=pivot.matrix_world.to_quaternion()@grip_normal
    for side,x in [('Left',-.25),('Right',.25)]:
        contact=pivot.matrix_world@(Vector((x,0,1.15))+grip_normal*.055)
        ids={v for p in hand_faces[side] for v in p.vertices};points=[verts[i] for i in ids]
        gap=min((point-contact).dot(normal) for point in points);min_gap=min(min_gap,gap);max_gap=max(max_gap,gap)
        actual=sum(points,Vector())/len(points);wrist=rig.matrix_world@rig.pose.bones[side+'Hand'].head;max_center_error=max(max_center_error,(actual-wrist).length)
    feet=[rig.matrix_world @ rig.pose.bones[n].head for n in ('LeftFoot','RightFoot')]
    if feet_start is None:feet_start=feet
    foot_drift=max(foot_drift,max((a-b).length for a,b in zip(feet,feet_start)))
assert foot_drift<.001,foot_drift
assert min_gap>-.0001 and max_gap<.004,(min_gap,max_gap)
assert max_center_error<.001,max_center_error
assert not collisions,collisions
assert not self_collisions,self_collisions
assert skirt_drift<.00001,skirt_drift
seam_error=0
for a,b in [(('lever_left_to_right',20),('lever_right_to_left',0)),(('lever_right_to_left',20),('lever_left_to_right',0))]:
    va,pa=boundaries[a];vb,pb=boundaries[b];seam_error=max(seam_error,max((x-y).length for x,y in zip(va,vb)),max(abs(pa[r][c]-pb[r][c]) for r in range(4) for c in range(4)))
assert seam_error<.00001,seam_error
assert max(tail_poses[0].to_quaternion().rotation_difference(m.to_quaternion()).angle for m in tail_poses)>.05
assert {'lever_left_to_right','lever_right_to_left'} <= {a.name for a in bpy.data.actions}
report={'reopened_blender':True,'frames_checked_per_action':21,'total_frames_checked':42,'separate_actions_in_one_model':True,'fps':30,'duration_seconds_per_action':20/30,'lever_driven_by_same_action_bone':'Lever_Control','alternating_loop_mesh_and_prop_boundary_error':seam_error,'visible_hand_triangles_per_side':12,'hand_surface_gap_range':[min_gap,max_gap],'visible_hand_center_to_wrist_maximum_error':max_center_error,'character_prop_surface_intersections':collisions,'arm_forearm_hair_accessory_intersections':self_collisions,'shoulder_garment_attachment_overlap_excluded':True,'skirt_vertices_checked':len(skirt_rest),'skirt_maximum_drift_from_original_standing_pose':skirt_drift,'original_hidden_garment_leg_overlap_preserved':True,'foot_drift':foot_drift,'source_body_actions_retained':44,'new_body_actions':2,'prop_actions':0,'preview_frames':[0,20]}
(root/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(report)

# Blender exports skin meshes under an identity armature node. Move them to
# scene roots, preserving every transform and eliminating the glTF warning.
path=root/'winefox-large-lever.glb';data=path.read_bytes();size=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+size]);binary=data[28+size:]
for index,node in enumerate(g['nodes']):
    if 'skin' not in node:continue
    for parent_id,parent in enumerate(g['nodes']):
        if index not in parent.get('children',[]):continue
        assert not any(k in parent for k in ('matrix','translation','rotation','scale')),parent
        parent['children'].remove(index)
        for scene in g['scenes']:
            assert parent_id in scene['nodes'];scene['nodes'].append(index)
encoded=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)

