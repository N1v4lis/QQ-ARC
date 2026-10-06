import bpy,json,math
from pathlib import Path
root=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(root/'snowfox-large-lever.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');names=['Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth'];results=[]
for name in names:
 obj=bpy.data.objects[name];image=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and n.image);w,h=image.size;pixels=list(image.pixels);uv=obj.data.uv_layers.active.data;count=0;faces=0
 for p in obj.data.polygons:
  if min(obj.data.vertices[i].co.z for i in p.vertices)>=rig.data.bones['Head'].head_local.z+.13:continue
  coords=[uv[i].uv for i in p.loop_indices]
  for y in range(max(0,math.floor(min(c.y for c in coords)*h)),min(h,math.ceil(max(c.y for c in coords)*h))):
   for x in range(max(0,math.floor(min(c.x for c in coords)*w)),min(w,math.ceil(max(c.x for c in coords)*w))):
    if pixels[(y*w+x)*4+3]>.5:count+=1
  faces+=1
 assert count>0,(name,'transparent mouth texture')
 results.append({'expression':name,'mouth_region_opaque_pixel_samples':count,'mouth_region_triangles':faces,'texture':image.name,'packed':bool(image.packed_file)})
assert next(n.image for n in bpy.data.objects['SnowFox_Mesh'].data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE').name.startswith('skin_white')
(root/'snow-mouth-opacity-verification.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print('SNOW_MOUTH_OPACITY_OK',results)
