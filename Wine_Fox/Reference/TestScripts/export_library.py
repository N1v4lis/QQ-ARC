import bpy,json,struct,os
from pathlib import Path
root=Path(__file__).parent;variants=(os.environ['LEVER_EXPORT_VARIANT'],) if os.environ.get('LEVER_EXPORT_VARIANT') else ('winefox','snowfox')
reports=json.loads((root/'library-glb-report.json').read_text()) if len(variants)==1 and (root/'library-glb-report.json').exists() else []
reports=[r for r in reports if r['variant'] not in variants]
for variant in variants:
    bpy.ops.wm.open_mainfile(filepath=str(root/(variant+'-large-lever.blend')))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');pivot=bpy.data.objects['Lever_Pivot']
    rig.animation_data.action=None;rig.animation_data.use_nla=True;rig['表情']=-1;rig['嘴巴张合']=-1.0
    for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
    for action in bpy.data.actions:
        track=rig.animation_data.nla_tracks.new();track.name=action.name;strip=track.strips.new(action.name,0,action);strip.action_frame_start=action.frame_range[0];strip.action_frame_end=action.frame_range[1];strip.extrapolation='NOTHING'
    for obj in bpy.context.scene.objects:
        if 'expressionMode' in obj:
            for prop in ('hide_viewport','hide_render'):obj.driver_remove(prop);setattr(obj,prop,False)
        obj.select_set(obj==rig or obj==pivot or obj.type=='MESH' and obj.name not in ('Studio_Floor','Unused_Expressions'))
    bpy.context.view_layer.objects.active=rig
    path=root/(variant+'-large-lever.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_merge_animation='NLA_TRACK',export_frame_range=False,export_force_sampling=True,export_extras=True,export_cameras=False,export_lights=False,export_morph=True,export_morph_animation=True)
    data=path.read_bytes();size=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+size]);binary=data[28+size:]
    for index,node in enumerate(g['nodes']):
        if 'skin' not in node:continue
        for parent_id,parent in enumerate(g['nodes']):
            if index not in parent.get('children',[]):continue
            assert not any(k in parent for k in ('matrix','translation','rotation','scale'))
            parent['children'].remove(index)
            for scene in g['scenes']:
                assert parent_id in scene['nodes'];scene['nodes'].append(index)
    encoded=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
    clips=[]
    for a in g['animations']:
        clips.append({'name':a['name'],'duration':max(g['accessors'][s['input']]['max'][0] for s in a['samplers']),'channels':len(a['channels']),'face_scale_channels':sum(g['nodes'][c['target']['node']].get('name','').startswith('FaceMode_') and c['target']['path']=='scale' for c in a['channels']),'mouth_morph_channels':sum(c['target']['path']=='weights' for c in a['channels'])})
    assert len(clips)==46,len(clips);assert next(a for a in clips if a['name']=='gui')['duration']==18
    assert all(a['face_scale_channels']==7 for a in clips),clips
    reports.append({'variant':variant,'clips':clips,'bytes':path.stat().st_size})
(root/'library-glb-report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8');print('LIBRARY_EXPORT_OK',[(r['variant'],r['bytes']) for r in reports])
