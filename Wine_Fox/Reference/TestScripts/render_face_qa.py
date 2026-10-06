import bpy,os
from pathlib import Path
from mathutils import Vector
root=Path(__file__).parent;folder=root/'QA';folder.mkdir(exist_ok=True)
for variant in ((os.environ['LEVER_VARIANT'],) if os.environ.get('LEVER_VARIANT') else ('winefox','snowfox')):
    bpy.ops.wm.open_mainfile(filepath=str(root/(variant+'-large-lever.blend')));scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False
    for name,frame,manual in [('gui',180,-1),('gui',200,-1)]+[('lever_left_to_right',10,i) for i in (0,1,2,3,4,5,6)]:
        rig.animation_data.action=bpy.data.actions[name];rig.animation_data.action_slot=rig.animation_data.action.slots[0];rig['表情']=manual;rig['嘴巴张合']=-1;rig.update_tag();scene.frame_set(frame);bpy.context.view_layer.update()
        head=rig.matrix_world@rig.pose.bones['Head'].head;target=head+Vector((0,0,.14));scene.camera.location=target+Vector((0,5,.25));scene.camera.rotation_euler=(target-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.ortho_scale=1.4
        scene.render.resolution_x=420;scene.render.resolution_y=420;scene.cycles.samples=4;scene.render.filepath=str(folder/f'{variant}-{name}-{frame:03}-expression-{manual}.png');bpy.ops.render.render(write_still=True)
