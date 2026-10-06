import bpy,json,math
from pathlib import Path
from mathutils import Euler
root=Path(__file__).parent;raw={}
for path in (root.parent/'01_taisho_maid/animations').rglob('*.json'):raw.update(json.loads(path.read_text(encoding='utf-8-sig')).get('animations',{}))
report=json.loads((root/'library-enhancement-report.json').read_text(encoding='utf-8'));params=[(5,0,10,1),(10,.3,4,1.1),(4,.5,6,1.3),(10,.6,3,1.5),(20,.6,0,0),(0,0,20,1.2)]
# Read authored poses from the preserved final base, never from a mutable backup.
bpy.ops.wm.open_mainfile(filepath=str(root.parent/'Finish/Models/Blender/winefox-animated.blend'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False;bases={}
for entry in report['actions']:
    name=entry['action']
    if entry['tail_status']!='source_parallel_oscillator_baked' or not raw.get(name,{}).get('loop'):continue
    action=bpy.data.actions[name];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];bpy.context.scene.frame_set(round(action.frame_range[0]));bpy.context.view_layer.update();bases[name]={n:rig.pose.bones[n].rotation_quaternion.copy() for n in ('Tail','Tail2','Tail3','Tail4','Tail5','Tail6')}
for variant in ('winefox','snowfox'):
    path=root/(variant+'-large-lever.blend');bpy.ops.wm.open_mainfile(filepath=str(path));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False
    for name,base in bases.items():
        action=bpy.data.actions[name];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];start,end=action.frame_range;duration=(end-start)/30;cycles=max(1,round(duration/3));period=duration/cycles;omega=2*math.pi/period
        K1=.8/math.pi/2;K2=1/(2*math.pi*2)**2;K3=20*.8/(2*math.pi*2);gain=K3/math.hypot(1-K2*omega*omega,K1*omega);lag=math.atan2(K1*omega,1-K2*omega*omega)
        factor=.08 if name=='sleep' else .2 if name=='elytra_fly' else 1
        for frame in sorted(set([start,end]+list(range(math.ceil(start),math.floor(end)+1)))):
            time=(frame-start)/30
            for n,(ay,dy,az,dz) in zip(base,params):
                y=factor*gain*ay*math.sin(omega*(time-dy)-lag);z=factor*gain*az*math.sin(omega*(time-dz)-lag)
                rig.pose.bones[n].rotation_quaternion=base[n]@Euler((0,math.radians(-y),math.radians(z)),'XYZ').to_quaternion();rig.pose.bones[n].keyframe_insert(data_path='rotation_quaternion',frame=frame,group=n)
        action['tail_loop_period_seconds']=period
        bpy.context.scene.frame_set(int(start),subframe=start%1);bpy.context.view_layer.update();q0=[rig.pose.bones[n].rotation_quaternion.copy() for n in base]
        bpy.context.scene.frame_set(int(end),subframe=end%1);bpy.context.view_layer.update();q1=[rig.pose.bones[n].rotation_quaternion.copy() for n in base]
        assert max(a.rotation_difference(b).angle for a,b in zip(q0,q1))<.001,name
    rig.animation_data.action=None;rig.animation_data.use_nla=True;bpy.context.scene.frame_set(0);bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=str(path))
print('CLOSED_TAIL_LOOPS',list(bases))
