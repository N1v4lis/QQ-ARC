export function personaUsage(template, accounts) {
  const names = [template.name,template.fromOwner ? template.name.replace(/（来自主账号）$/,'') : template.name];
  const matches = persona => {
    if (template.builtin && persona?.templateRef?.builtin && persona.templateRef.id === template.id) return true;
    return String(persona?.roleText || '').trim() === String(template.text || '').trim()
      && String(persona?.customRules || '').trim() === String(template.customRules || '').trim()
      && (template.id==='owner_current' || !persona?.name || names.includes(persona.name) || names.includes(persona.templateRef?.name));
  };
  return accounts.flatMap(({uin,config}) => {
    const base=config.persona || {}, keys=new Set();
    for(const id of config.allow?.groups || [])keys.add('group:'+id);
    for(const id of config.allow?.private || [])keys.add('private:'+id);
    const rows=[];
    for(const target of keys){
      const raw=config.personaByChat?.[target] || config.personaByChat?.[target.split(':')[1]] || {};
      const ownRole=!!String(raw.roleText || '').trim();
      const effective={...base,...raw,name:ownRole?raw.name:base.name,templateRef:ownRole?raw.templateRef:base.templateRef,roleText:ownRole?raw.roleText:base.roleText,customRules:String(raw.customRules || '').trim()?raw.customRules:base.customRules};
      if(matches(effective))rows.push({account:String(uin),target,inherited:!String(raw.roleText || '').trim()});
    }
    if(matches(base) && config.allowAllWhenEmpty && !keys.size) rows.push({account:String(uin),target:'all',inherited:true});
    return rows;
  });
}
