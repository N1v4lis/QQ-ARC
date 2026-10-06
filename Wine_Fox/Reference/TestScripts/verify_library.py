import bpy,json,math
from pathlib import Path
root=Path(__file__).parent;reports=[];gui_reference={}
expressions=['Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth']
for variant in ('winefox','snowfox'):
    bpy.ops.wm.open_mainfile(filepath=str(root/(variant+'-large-lever.blend')))
    scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False
    assert not scene.use_preview_range and scene.frame_end>=math.ceil(max(a.frame_range[1] for a in bpy.data.actions))
    assert all(not a.use_frame_range for a in bpy.data.actions)
    results=[];cases=0
    for action in bpy.data.actions:
        rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
        start,end=action.frame_range
        for frame in sorted(set([round(start),round((start+end)/2),math.floor(end)]+([120,150,166,180,190,200,360,540] if action.name=='gui' else []))):
            for manual in range(-1,7):
                rig['表情']=manual;rig['嘴巴张合']=.7 if manual>=0 else -1.0;rig.update_tag();scene.frame_set(frame);bpy.context.view_layer.update()
                effective=manual if manual>=0 else round(rig['自动表情'])
                for mode,name in enumerate(expressions):
                    obj=bpy.data.objects[name];assert obj.hide_viewport==(mode!=effective),(variant,action.name,frame,manual,name)
                    assert obj.hide_render==(mode!=effective)
                    scales=rig.pose.bones[f'FaceMode_{mode}'].scale
                    assert all(abs(x-1)<.00001 if mode==effective else abs(x)<.00002 for x in scales),(variant,action.name,frame,manual,effective,mode,list(scales))
                for bone in rig.pose.bones:
                    assert all(math.isfinite(x) for row in bone.matrix for x in row),(action.name,bone.name)
                selected=bpy.data.objects[expressions[effective]];ev=selected.evaluated_get(bpy.context.evaluated_depsgraph_get())
                assert all(math.isfinite(x) for v in ev.data.vertices for x in v.co)
                expected_mouth=.7 if manual>=0 else rig['自动嘴巴']
                assert abs(selected.data.shape_keys.key_blocks['Mouth_Open'].value-expected_mouth)<.00001,(variant,action.name,manual,'mouth driver')
                cases+=1
            if action.name=='gui':
                key=frame;pose={b.name:[list(row) for row in b.matrix] for b in rig.pose.bones}
                if variant=='winefox':gui_reference[key]=pose
                else:assert pose==gui_reference[key],('gui mismatch',frame)
        rig['表情']=-1;rig['嘴巴张合']=-1.0
        if action.name=='gui':
            assert tuple(action.frame_range)==(0.0,540.0)
            scene.frame_set(180);bpy.context.view_layer.update();assert rig['自动表情']==4
            scene.frame_set(200);bpy.context.view_layer.update();assert rig['自动表情']==0
        # Detect local tail motion, rather than body motion carrying the tail.
        samples=[]
        for fraction in (0,.13,.31,.57,.83,1):
            f=start+(end-start)*fraction;scene.frame_set(int(f),subframe=f%1);bpy.context.view_layer.update();samples.append([rig.pose.bones[n].rotation_quaternion.copy() for n in ('MTail','Tail','Tail2','Tail3','Tail4','Tail5','Tail6','Tail7')])
        variation=max(math.degrees(a.rotation_difference(b).angle) for pose in samples for a,b in zip(samples[0],pose))
        status=action.get('tail_repair','unknown')
        if status=='source_parallel_oscillator_baked':assert variation>.01,(variant,action.name,variation)
        if 'tail_loop_period_seconds' in action and action.get('original_source_loop') not in ('False','None'):
            assert max(a.rotation_difference(b).angle for a,b in zip(samples[0],samples[-1]))<.001,(variant,action.name,'tail loop boundary')
        results.append({'action':action.name,'tail_variation_degrees':variation,'tail_status':status,'range':list(action.frame_range)})
    reports.append({'variant':variant,'actions':results,'expression_compatibility_cases':cases,'manual_states':7,'automatic_state':True,'mouth_manual_and_auto':True,'gui_synced_after_frame_120':True,'gui_frames':[0,540],'fps':scene.render.fps,'playback_end':scene.frame_end,'no_preview_or_action_range_restriction':True})
(root/'library-verification.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8');print('LIBRARY_VERIFY_OK',[(r['variant'],r['expression_compatibility_cases']) for r in reports])
