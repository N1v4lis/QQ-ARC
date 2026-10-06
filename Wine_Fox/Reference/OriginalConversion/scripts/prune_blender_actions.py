import bpy,json
from pathlib import Path
root=Path(__file__).parent
request=json.loads((root/'trimmed/removal-request.json').read_text(encoding='utf-8'))
all_names=sorted(request['all_source_names'],key=len,reverse=True)
removed=set(request['removed_source_names']); results=[]
def source_name(name):
    return next((n for n in all_names if name==n or name.startswith(n+'_') or name.startswith(n+'.')),name)
for variant in ('winefox','snowfox'):
    for suffix in ('animated','fly-speed'):
        source=root/'openysm-checked'/(variant+'-blender')/(variant+'-'+suffix+'.blend')
        target=root/'trimmed'/(variant+'-blender')/source.name
        bpy.ops.wm.open_mainfile(filepath=str(source))
        selected=[a for a in bpy.data.actions if source_name(a.name) in removed]
        deleted_names=[source_name(a.name) for a in selected]; before=len(bpy.data.actions)
        for obj in bpy.data.objects:
            data=obj.animation_data
            if not data: continue
            if data.action in selected: data.action=None
            for track in list(data.nla_tracks):
                for strip in list(track.strips):
                    if strip.action in selected: track.strips.remove(strip)
                if not track.strips: data.nla_tracks.remove(track)
        for action in selected: bpy.data.actions.remove(action,do_unlink=True)
        assert all(source_name(a.name) not in removed for a in bpy.data.actions)
        remaining=len(bpy.data.actions)
        bpy.ops.wm.save_as_mainfile(filepath=str(target))
        bpy.ops.wm.open_mainfile(filepath=str(target))
        assert len(bpy.data.actions)==remaining
        assert all(source_name(a.name) not in removed for a in bpy.data.actions)
        assert not any(source_name(a.name)=='ride_pig' for a in bpy.data.actions)
        assert any(source_name(a.name)=='fly' for a in bpy.data.actions)
        assert not bpy.context.scene.use_preview_range and bpy.context.scene.frame_end==1801
        if suffix=='fly-speed': assert bpy.data.objects.get('飞行控制器') is not None
        results.append({'file':str(target),'before':before,'after':remaining,'removed':deleted_names})
(root/'trimmed/blender-removal-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
