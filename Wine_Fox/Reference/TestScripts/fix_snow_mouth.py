import bpy,math,json,hashlib
from pathlib import Path
root=Path(__file__).parent;path=root/'snowfox-large-lever.blend'
bpy.ops.wm.open_mainfile(filepath=str(path))
names=['Normal_Mouth','Happy_Mouth','Anger_Mark','Wave_Mouth','Surprise_Mouth','Expression5_Mouth','Expression6_Mouth']
def signatures():
    result={}
    for action in bpy.data.actions:
        curves=action.layers[0].strips[0].channelbag(action.slots[0]).fcurves
        data=[(c.data_path,c.array_index,[(tuple(k.co),k.interpolation) for k in c.keyframe_points]) for c in curves]
        result[action.name]=hashlib.sha256(repr(data).encode()).hexdigest()
    return result
before=signatures();white=bpy.data.images.load(str(root.parent/'01_taisho_maid/textures/skin_white.png'),check_existing=True);wine=bpy.data.images.load(str(root.parent/'01_taisho_maid/textures/skin.png'),check_existing=True)
w,h=white.size;pixels=list(white.pixels);source=list(wine.pixels);used=set()
for name in names:
    obj=bpy.data.objects[name];uv=obj.data.uv_layers.active.data
    for p in obj.data.polygons:
        coords=[uv[i].uv for i in p.loop_indices]
        for y in range(max(0,math.floor(min(c.y for c in coords)*h)),min(h,math.ceil(max(c.y for c in coords)*h))):
            for x in range(max(0,math.floor(min(c.x for c in coords)*w)),min(w,math.ceil(max(c.x for c in coords)*w))):used.add(y*w+x)
restored=[]
for index in used:
    offset=index*4
    if pixels[offset+3]<.01 and source[offset+3]>.5:
        pixels[offset:offset+4]=source[offset:offset+4];restored.append(index)
assert restored,'No missing facial pixels found'
atlas=bpy.data.images.new('SnowFox_Face_Atlas',width=w,height=h,alpha=True);atlas.colorspace_settings.name='sRGB';atlas.pixels.foreach_set(pixels);atlas.update()
folder=root/'textures';folder.mkdir(exist_ok=True);atlas.filepath_raw=str(folder/'snowfox-face-atlas.png');atlas.file_format='PNG';atlas.save();atlas.pack()
material=bpy.data.objects[names[0]].data.materials[0].copy();material.name='SnowFox face restored'
for node in material.node_tree.nodes:
    if node.type=='TEX_IMAGE' and node.image:node.image=atlas
for name in names:
    obj=bpy.data.objects[name];obj.data.materials.clear();obj.data.materials.append(material)
    for p in obj.data.polygons:p.material_index=0
assert signatures()==before,'Animation changed during texture repair'
bpy.ops.wm.save_as_mainfile(filepath=str(path))
(root/'snowfox-mouth-fix.json').write_text(json.dumps({'restored_opaque_face_pixels':len(restored),'face_texture':str(folder/'snowfox-face-atlas.png'),'affected_meshes':names,'action_count':len(before),'all_action_curves_unchanged':True,'body_texture_unchanged':True,'source_cause':'skin_white.png has transparent pixels in the WineFox mouth UV regions'},indent=2),encoding='utf-8');print('SNOW_MOUTH_FIXED',len(restored))
