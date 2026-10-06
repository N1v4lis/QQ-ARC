import bpy,json
from pathlib import Path
root=Path(__file__).parent;report=[]
for direction in ('left_to_right','right_to_left'):
    path=root/('winefox-lever-'+direction.replace('_','-')+'.blend');bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
    assert (scene.frame_start,scene.frame_end,scene.render.fps)==(0,30,30)
    for obj in (next(o for o in scene.objects if o.type=='ARMATURE'),bpy.data.objects['Lever_Pivot']):
        enabled=[t.name for t in obj.animation_data.nla_tracks if not t.mute];assert enabled==['lever_'+direction],enabled
    report.append({'file':path.name,'enabled_action':'lever_'+direction,'frames':[0,30],'fps':30})
(root/'separate-files-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(report)
