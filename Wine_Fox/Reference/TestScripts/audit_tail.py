import bpy,json,math
from pathlib import Path
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root/'winefox-large-lever.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False
source={}
for path in (root.parent/'01_taisho_maid/animations').rglob('*.json'):
    for name,anim in json.loads(path.read_text(encoding='utf-8-sig')).get('animations',{}).items():
        source[name]={'file':str(path),'duration':anim.get('animation_length'),'loop':anim.get('loop'),'tail':{n:v for n,v in anim.get('bones',{}).items() if n in ('MTail','Tail','Tail2','Tail3','Tail4','Tail5','Tail6','Tail7')},'ears':{n:v for n,v in anim.get('bones',{}).items() if 'ear' in n.lower()}}
results=[]
for action in bpy.data.actions:
    if action.name.endswith('_prop'):continue
    rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
    start,end=action.frame_range;poses=[]
    for i in range(31):
        bpy.context.scene.frame_set(int(start+(end-start)*i/30));bpy.context.view_layer.update();poses.append({n:rig.pose.bones[n].rotation_quaternion.copy() for n in ('MTail','Tail','Tail2','Tail3','Tail4','Tail5','Tail6','Tail7')})
    variations={n:max(math.degrees(poses[0][n].rotation_difference(p[n]).angle) for p in poses) for n in poses[0]}
    raw=source.get(action.name,{})
    if not raw:raw=next((v for k,v in source.items() if k.split('.')[-1]==action.name),{})
    results.append({'name':action.name,'range':[start,end],'tail_bone_variation_degrees':variations,'moving':max(variations.values())>.1,'source':raw})
(root/'tail-audit-before.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print([(r['name'],r['range'],r['moving'],list(r['source'].get('tail',{}))) for r in results])
