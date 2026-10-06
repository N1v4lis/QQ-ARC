import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = process.argv[3];
if (!src || !out) throw new Error('usage: node convert-ysm-wine-fox.mjs <ysm-dir> <out-dir>');
const model = JSON.parse(fs.readFileSync(path.join(src, 'models', 'main.json'), 'utf8'));
const animFile = JSON.parse(fs.readFileSync(path.join(src, 'animations', 'main.animation.json'), 'utf8'));
const geo = model['minecraft:geometry']?.[0];
if (!geo?.bones?.length) throw new Error('YSM model has no bones');
const bones = geo.bones;
const uuid = (name) => `ysm:${name}`;
const face = (c, name) => {
  const [x, y, z] = c.size;
  if (c.uv && !Array.isArray(c.uv)) {
    const side = c.uv[name] || c.uv.north;
    const [u, v] = side.uv || [0, 0];
    const [w, h] = side.uv_size || [x, y];
    return [u, v, u + w, v + h];
  }
  const [u, v] = c.uv || [0, 0];
  const rects = {
    north: [u + z, v + z, u + z + x, v + z + y],
    south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
    west: [u, v + z, u + z, v + z + y],
    east: [u + z + x, v + z, u + z + x + z, v + z + y],
    up: [u + z, v, u + z + x, v + z],
    down: [u + z + x, v, u + z + x + x, v + z]
  };
  return rects[name];
};
const convertCube = (c, index) => {
  const names = ['north', 'south', 'west', 'east', 'up', 'down'];
  const faces = Object.fromEntries(names.map((n) => [n, face(c, n)]));
  return { uuid: `cube:${index}`, from: c.origin, to: c.origin.map((v, i) => v + c.size[i]), origin: c.pivot || c.origin.map((v, i) => v + c.size[i] / 2), rotation: c.rotation || [0, 0, 0], faces };
};
let cubeIndex = 0;
const childrenByParent = new Map();
for (const b of bones) {
  const key = b.parent || null;
  if (!childrenByParent.has(key)) childrenByParent.set(key, []);
  childrenByParent.get(key).push(b);
}
const makeBone = (b) => ({ uuid: uuid(b.name), name: b.name, origin: b.pivot || [0, 0, 0], rotation: b.rotation || [0, 0, 0], cubes: (b.cubes || []).map((c) => convertCube(c, cubeIndex++)), children: (childrenByParent.get(b.name) || []).map(makeBone) });
const outliner = (childrenByParent.get(null) || []).map(makeBone);
const animations = [];
for (const [name, a] of Object.entries(animFile.animations || {})) {
  const animators = {};
  for (const [boneName, tracks] of Object.entries(a.bones || {})) {
    const channels = {};
    for (const channel of ['rotation', 'position', 'scale']) {
      const track = tracks[channel];
      if (!track || typeof track !== 'object') continue;
      const keys = Object.entries(track).map(([time, value]) => [Number(time), ...(Array.isArray(value) ? value : (value.post || value.pre || [0, 0, 0]))]);
      if (keys.length) channels[channel] = { i: 'linear', k: keys };
    }
    if (Object.keys(channels).length) animators[uuid(boneName)] = channels;
  }
  animations.push({ name, length: Number(a.animation_length || 0), loop: a.loop === 'hold_on_last_frame' ? 'once' : 'loop', animators });
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'wine-fox.model.json'), JSON.stringify({ name: 'Wine Fox（酒狐）', resolution: { width: geo.description.texture_width, height: geo.description.texture_height }, outliner, textures: [{ index: 0, file: 'wine-fox.skin.png', width: geo.description.texture_width, height: geo.description.texture_height }], animations }, null, 2));
fs.writeFileSync(path.join(out, 'wine-fox.manifest.json'), JSON.stringify({ models: [{ id: 'wine-fox', label: 'LegacyYSM 酒狐', facing: 0, model: 'wine-fox.model.json', textures: ['wine-fox.skin.png'], source: 'RuiXuqi/LegacyYSM wine_fox / UI/01_taisho_maid', license: 'CC BY-NC-SA 4.0' }] }, null, 2));
console.log(`converted ${cubeIndex} cubes and ${animations.length} animations`);
