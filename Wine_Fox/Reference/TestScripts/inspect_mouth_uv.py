import bpy,json
from pathlib import Path
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root/'snowfox-large-lever.blend'))
for name in ('Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth'):
 o=bpy.data.objects[name];uv=o.data.uv_layers.active.data;print(name,[(min(uv[i].uv.x*256 for i in p.loop_indices),max(uv[i].uv.x*256 for i in p.loop_indices),min((1-uv[i].uv.y)*256 for i in p.loop_indices),max((1-uv[i].uv.y)*256 for i in p.loop_indices)) for p in o.data.polygons][:15])
 print('materials',[(s.material.name,[(n.image.name,n.image.filepath) for n in s.material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]) for s in o.material_slots])
