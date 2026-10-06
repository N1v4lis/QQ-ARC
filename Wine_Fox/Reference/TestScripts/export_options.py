import bpy
for p in bpy.ops.export_scene.gltf.get_rna_type().properties:
    if 'anim' in p.identifier:
        print(p.identifier,[(i.identifier,i.description[:90]) for i in p.enum_items] if p.type=='ENUM' else p.type)
