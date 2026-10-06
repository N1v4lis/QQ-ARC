import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent;report=[]
for variant in ('winefox','snowfox'):
    path=root/'Models/Blender'/f'{variant}-large-lever.blend'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    assert len(bpy.data.actions)==46 and len(rig.data.bones)==203
    assert bpy.context.scene.render.fps==30
    assert not bpy.context.scene.use_preview_range
    assert all(not a.use_frame_range for a in bpy.data.actions)
    images={n.image for m in bpy.data.materials if m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
    entries=[]
    for image in images:
        packed=bool(image.packed_file or image.packed_files)
        assert packed,(variant,image.name,image.filepath)
        entries.append({'name':image.name,'packed':packed,'size':list(image.size)})
    report.append({'variant':variant,'actions':46,'bones':203,'fps':30,'frame_range':[bpy.context.scene.frame_start,bpy.context.scene.frame_end],'all_material_images_packed':True,'images':entries})
(root/'Verification/blender-portability.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('PACKAGED_BLENDS_OK',report)
