import bpy,json
from pathlib import Path
root=Path(__file__).parent;source=root.parent/'game-pack-conversion/mouth-clean/snowfox-blender/snowfox-animated.blend'
bpy.ops.wm.open_mainfile(filepath=str(source));a=bpy.data.actions['gui'];print('ORIGINAL_SNOW_GUI',list(a.frame_range),bpy.context.scene.render.fps);assert tuple(a.frame_range)==(0.0,540.0);assert bpy.context.scene.render.fps==30
