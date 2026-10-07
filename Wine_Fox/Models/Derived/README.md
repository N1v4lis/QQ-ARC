# GUI分割与全身展示衍生模型

由tools/split-fox-gui.mjs从../GLB两份原始模型生成，各47片段；gui=4秒、gui2=14秒，30fps、120帧边界连续。

两段GUI的GuiRoot/MRoot展示变换改用idle值，Root尺度除以2，修正放大、偏移导致的半身显示；身体与面部动作保留，非GUI动作曲线与几何材质不改。片段extras.arcfoxPlayback记录持续动作repeat、death及其他动作once。

原始GLB和Blender不变，未同步修改.blend动作。SOURCE.txt保留来源及许可，MANIFEST.json记录当前源文件与衍生模型哈希。根MANIFEST.json仍是原始交付清单。

运行副本由tools/prepare-wine-fox.mjs准备；完整说明见项目docs/WINE-FOX-INTERACTION.md。
