import bpy,bmesh,json,shutil
from pathlib import Path
root=Path(__file__).parent;out=root/'expression-library/winefox-blender';out.mkdir(parents=True,exist_ok=True)
definitions={'Normal_Mouth':('Mouth_smile2',),'Happy_Mouth':('Expression_3',),'Anger_Mark':('Expression_7','Head_E_T_1_1','Head_E_T_1_2'),'Wave_Mouth':('Mouth_chill',),'Surprise_Mouth':('Mouth_surprise',),'Expression5_Mouth':('Expression_5',),'Expression6_Mouth':('Expression_6',)};results=[]
for suffix in ('animated','fly-speed'):
    source=root/'mouth-clean/winefox-blender'/('winefox-'+suffix+'.blend');bpy.ops.wm.open_mainfile(filepath=str(source))
    mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH');rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    face_bones={f.index:mesh.vertex_groups[mesh.data.vertices[f.vertices[0]].groups[0].group].name for f in mesh.data.polygons}
    all_faces=set(face_bones);facial={i for i,n in face_bones.items() if n.startswith('Mouth_') or n.startswith('Expression_') or n.startswith('Head_E_T_1_')}
    def retain(obj,keep):
        bm=bmesh.new();bm.from_mesh(obj.data);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.faces[i] for i in all_faces-keep],context='FACES');bm.to_mesh(obj.data);bm.free();obj.data.update()
    rig['表情']=0;rig.id_properties_ui('表情').update(min=0,max=6,soft_min=0,soft_max=6,description='0=普通闭嘴微笑，1=开心张嘴笑，2=生气，3=紧张锯齿嘴，4=惊讶大张嘴，5=小张嘴，6=呆住方眼；可插入关键帧')
    chosen=set()
    for mode,(name,bones) in enumerate(definitions.items()):
        keep={i for i,n in face_bones.items() if n in bones};assert len(keep)>0;chosen|=keep
        obj=mesh.copy();obj.data=mesh.data.copy();obj.name=name;bpy.context.collection.objects.link(obj);retain(obj,keep)
        obj.vertex_groups.clear();head=obj.vertex_groups.new(name='Head');head.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        for vertex in obj.data.vertices:vertex.co.y+=1/16
        for prop in ('hide_viewport','hide_render'):
            driver=obj.driver_add(prop).driver;driver.type='SCRIPTED';driver.expression=f'round(expression) != {mode}'
            var=driver.variables.new();var.name='expression';var.type='SINGLE_PROP';var.targets[0].id=rig;var.targets[0].data_path='["表情"]'
    # Preserve unused source expressions as a hidden archive, outside playback.
    archive=mesh.copy();archive.data=mesh.data.copy();archive.name='Unused_Expressions';bpy.context.collection.objects.link(archive);retain(archive,facial-chosen);archive.hide_viewport=True;archive.hide_render=True
    retain(mesh,all_faces-facial);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    target=out/source.name;bpy.ops.wm.save_as_mainfile(filepath=str(target));bpy.ops.wm.open_mainfile(filepath=str(target));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');assert len(bpy.data.actions)==44
    for action in bpy.data.actions:
        rig.animation_data.action=action
        if action.slots:rig.animation_data.action_slot=action.slots[0]
        for mode in range(7):
            rig['表情']=mode;rig.update_tag();bpy.context.scene.frame_set(8);bpy.context.view_layer.update()
            for index,name in enumerate(definitions):
                obj=bpy.data.objects[name];assert bool(obj.hide_viewport)==(mode!=index);assert bool(obj.hide_render)==(mode!=index)
    results.append({'file':str(target),'animations_tested':44,'expressions':7,'default':0})
shutil.copy2(root/'mouth-clean/winefox-blender/SOURCE.txt',out/'SOURCE.txt');(out.parent/'verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print(results)
