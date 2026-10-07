// Pure source transformations; old settings are retained on disk for rollback.
export function patchPersonaInheritance(source) {
  source=source.replace(/ \* ⚠️ personaUnified = true[\s\S]*? \*    且统一模式下 UI 隐藏了[\s\S]*? \*    开关关掉后条目恢复生效[^\r\n]*/,' * 独立会话人设自动逐字段覆盖默认人设；空字段沿用默认。旧 personaUnified 不再参与判断。');
  source=source.replace('  // 统一人设模式：一律用全局，不看 personaByChat','  // 单会话字段覆盖默认值，无需额外开关。');
  if(source.includes('// ARCFOX automatic persona inheritance v1')) return source;
  const anchor="  if (getConfig().personaUnified !== false) return base;";
  if(source.split(anchor).length!==2)throw Error('Persona inheritance anchor changed');
  return source.replace(anchor,'  // ARCFOX automatic persona inheritance v1: independent fields override defaults.');
}
export function patchModelInheritance(source) {
  source=source.replace('  // 精确指定 > 按类型；两者都没配模型就返回 null（不动）','  // 单会话模型优先；未指定则返回 null，沿用主模型。');
  if(source.includes('// ARCFOX automatic model inheritance v1')) return source;
  const anchor="  const scopedHit = (exact && String(exact.model || '').trim()) ? exact : map[kind];";
  if(source.split(anchor).length!==2)throw Error('Model inheritance anchor changed');
  return source.replace(anchor,"  // ARCFOX automatic model inheritance v1: exact override or primary model.\n  const scopedHit = exact;");
}
