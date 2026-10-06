import bpy,json,bmesh
from pathlib import Path
root=Path(__file__).parent; results=[]
for variant in ('winefox','snowfox'):
    for suffix in ('animated','fly-speed'):
        source=root/'trimmed'/(variant+'-blender')/(variant+'-'+suffix+'.blend')
        out=root/'mouth-clean'/(variant+'-blender')
        bpy.ops.wm.open_mainfile(filepath=str(source))
        mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        original_actions=set(bpy.data.actions)
        original_groups=[v.name for v in mesh.vertex_groups]
        original_faces=len(mesh.data.polygons)
        group=mesh.vertex_groups['Expression_5'].index
        uv=mesh.data.uv_layers.active.data
        selected=[]
        for face in mesh.data.polygons:
            if not all(any(g.group==group and g.weight>.9 for g in mesh.data.vertices[i].groups) for i in face.vertices): continue
            coords=[(uv[i].uv.x*256,(1-uv[i].uv.y)*256) for i in face.loop_indices]
            if all(143.99<=u<=150.01 and 60.99<=v<=64.01 for u,v in coords): selected.append(face.index)
        print(variant,suffix,'target faces',selected,flush=True)
        assert len(selected)==12,len(selected)
        bm=bmesh.new();bm.from_mesh(mesh.data);bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[bm.faces[i] for i in selected],context='FACES')
        bm.to_mesh(mesh.data);bm.free();mesh.data.update()
        assert original_faces-len(mesh.data.polygons)==12
        assert original_groups==[v.name for v in mesh.vertex_groups]
        assert set(bpy.data.actions)==original_actions and len(original_actions)==44
        target=out/source.name
        bpy.ops.wm.save_as_mainfile(filepath=str(target))
        bpy.ops.wm.open_mainfile(filepath=str(target))
        assert len(bpy.data.actions)==44
        if suffix=='fly-speed': assert bpy.data.objects.get('飞行控制器') is not None
        results.append({'file':str(target),'animations':44,'removed_triangles':12})
(root/'mouth-clean/blender-verification.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results))
