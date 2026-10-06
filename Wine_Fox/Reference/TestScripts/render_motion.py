import bpy,os
from pathlib import Path
root=Path(__file__).parent;variant=os.environ.get('LEVER_VARIANT','winefox');bpy.ops.wm.open_mainfile(filepath=str(root/(variant+'-large-lever.blend')));scene=bpy.context.scene
folder=root/('frames' if variant=='winefox' else 'snowfox-frames');folder.mkdir(exist_ok=True)
scene.render.resolution_x=600;scene.render.resolution_y=500;scene.cycles.samples=4
rig=next(o for o in scene.objects if o.type=='ARMATURE');pivot=bpy.data.objects['Lever_Pivot']
for direction in ('left_to_right','right_to_left'):
    for obj in (rig,):
        for track in obj.animation_data.nla_tracks:track.mute=track.name!='lever_'+direction
    for frame in range(0,21,2):
        scene.frame_set(frame);scene.render.filepath=str(folder/f'{direction}-{frame:03}.png');bpy.ops.render.render(write_still=True)
