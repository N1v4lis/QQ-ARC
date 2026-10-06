import bpy,json,hashlib
from pathlib import Path
root=Path(__file__).parent
report=[]
def curves(action):
    return action.layers[0].strips[0].channelbag(action.slots[0]).fcurves
def signature(action):
    data=[(c.data_path,c.array_index,[(tuple(k.co),tuple(k.handle_left),tuple(k.handle_right),k.interpolation) for k in c.keyframe_points]) for c in curves(action) if not (action.name in {'death','game_lost'} and c.data_path=='["自动表情"]')]
    return hashlib.sha256(repr(data).encode()).hexdigest()
for variant in ('winefox','snowfox'):
    path=root/(variant+'-large-lever.blend');bpy.ops.wm.open_mainfile(filepath=str(path))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');scene=bpy.context.scene
    before={a.name:signature(a) for a in bpy.data.actions}
    previous_action=rig.animation_data.action;previous_slot=rig.animation_data.action_slot
    previous_nla=rig.animation_data.use_nla;previous_frame=scene.frame_current
    rig.animation_data.use_nla=False
    entries=[]
    for name in ('death','game_lost'):
        action=bpy.data.actions[name];matching=[c for c in curves(action) if c.data_path=='["自动表情"]'];assert len(matching)==1
        for key in matching[0].keyframe_points:
            key.co.y=6;key.handle_left.y=6;key.handle_right.y=6;key.interpolation='CONSTANT'
        matching[0].update()
        rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
        start,end=action.frame_range
        for frame in (int(start),round((start+end)/2),int(end)):
            for manual in range(-1,7):
                rig['表情']=manual;rig.update_tag();scene.frame_set(frame);bpy.context.view_layer.update()
                assert round(rig['自动表情'])==6,(variant,name,frame)
                chosen=6 if manual<0 else manual
                for mode in range(7):
                    assert abs(rig.pose.bones[f'FaceMode_{mode}'].scale.x-(1 if mode==chosen else 0))<.00002
        entries.append({'action':name,'range':[start,end],'automatic_mode':6,'manual_states_verified':7})
    assert before=={a.name:signature(a) for a in bpy.data.actions},'Unrelated animation data changed'
    rig['表情']=-1;rig.animation_data.action=previous_action
    if previous_action:rig.animation_data.action_slot=previous_slot
    rig.animation_data.use_nla=previous_nla;scene.frame_set(previous_frame);bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    report.append({'variant':variant,'actions':entries,'other_curves_unchanged':True})
(root/'sad-expression-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SAD_EXPRESSIONS_OK',report)
