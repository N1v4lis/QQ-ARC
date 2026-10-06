"""Audit every configured player clip against the downloaded OpenYSM semantics."""
import ast,json,re,math,functools,bisect,collections
from pathlib import Path
from types import SimpleNamespace
import numpy as np
root=Path(__file__).parent; out=root/'game-pack-conversion/openysm-checked'
namespace={'np':np,'math':math,'functools':functools,'re':re,'bisect':bisect,
           'unknown':set(),'errors':set(),'options':SimpleNamespace(openysm=True)}
tree=ast.parse((root/'convert_winefox_animated.py').read_text(encoding='utf-8'))
chosen=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('parse','evaluate','sample')
        or isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('TOKEN','PRECEDENCE','DEFAULTS') for t in node.targets)]
exec(compile(ast.Module(body=chosen,type_ignores=[]),'converter-evaluation','exec'),namespace)
defaults=namespace['DEFAULTS']; model=json.loads((out/'game-pack-intermediate.bbmodel').read_text(encoding='utf-8'))
groups={}
def walk(nodes):
    for node in nodes:
        if isinstance(node,dict): groups[node['uuid']]=node; walk(node['children'])
walk(model['outliner']); bone_names={node['name'] for node in groups.values()}
config=json.loads((root/'01_taisho_maid/ysm.json').read_text(encoding='utf-8-sig'))
raw={}; duplicates=[]
for file in config['files']['player']['animation'].values():
    for name,clip in json.loads((root/'01_taisho_maid'/file).read_text(encoding='utf-8-sig'))['animations'].items():
        if name in raw: duplicates.append({'name':name,'file':file}); continue
        raw[name]=(file,clip)
rows=[]
for animation in model['animations']:
    name=animation['name']; file,source=raw[name]
    numeric_differences=[]; prepost=0; variables=set(); errors=[]; expression_count=0
    for animator in animation['animators'].values():
        channels=collections.defaultdict(list)
        for key in animator['keyframes']:
            channels[key['channel']].append(key)
            if key.get('pre_data_point')!=None and key['pre_data_point']!=key['data_points'][0]: prepost+=1
            for payload in [key['data_points'][0],key.get('pre_data_point',{})]:
                for expression in payload.values():
                    try: float(expression); continue
                    except ValueError: pass
                    expression_count+=1
                    variables.update(re.findall(r'\b(?:ysm|q|query|v|ctrl)\.[\w.]+',expression))
                    namespace['errors'].clear()
                    namespace['evaluate'](expression,dict(defaults,**{'query.anim_time':.25,'query.life_time':.25,'query.time_stamp':.25}))
                    for bad,error in namespace['errors']:
                        errors.append({'bone':animator['name'],'channel':key['channel'],'time':key['time'],'expression':bad,'error':error})
        for channel,keys in channels.items():
            keys.sort(key=lambda k:k['time'])
            largest=0
            for a,b in zip(keys,keys[1:]):
                if b['time']<=a['time']: continue
                for fraction in (.1,.5,.9):
                    time=a['time']+(b['time']-a['time'])*fraction
                    env=dict(defaults,**{'query.anim_time':time,'query.life_time':time,'query.time_stamp':time})
                    namespace['options'].openysm=True
                    fixed=namespace['sample'](keys,time,env.copy(),channel,animation['loop']=='loop')
                    namespace['options'].openysm=False
                    previous=namespace['sample'](keys,time,env.copy(),channel,animation['loop']=='loop')
                    largest=max(largest,float(np.max(np.abs(fixed-previous))))
            namespace['options'].openysm=True
            if largest>1e-5: numeric_differences.append({'bone':animator['name'],'channel':channel,'max_sampled_component_change':largest})
    rows.append({'name':name,'file':file,'loop':animation['loop'],'source_loop':source.get('loop',False),
        'expression_components':expression_count,'variables':sorted(variables),
        'missing_geometry_bones':sorted(set(source.get('bones',{}))-bone_names),
        'timeline_events':len(source.get('timeline',{})),'sound_events':len(source.get('sound_effects',{})),
        'blend_weight':source.get('blend_weight'),'pre_post_discontinuities':prepost,
        'corrected_curve_tracks':numeric_differences,'expression_errors':errors})
summary={'source_clips':len(rows),'exported_actions':94,
    'hold_clips':[r['name'] for r in rows if r['loop']=='hold'],
    'curve_changed_clips':[r['name'] for r in rows if r['corrected_curve_tracks']],
    'pre_post_clips':[r['name'] for r in rows if r['pre_post_discontinuities']],
    'runtime_dependent_clips':[r['name'] for r in rows if r['variables'] or r['timeline_events'] or r['blend_weight']],
    'clips_with_missing_geometry_bones':[r['name'] for r in rows if r['missing_geometry_bones']],
    'remaining_expression_error_clips':[r['name'] for r in rows if r['expression_errors']],
    'duplicate_names':duplicates,
    'reference_commit':json.loads((root/'openysm-code/tree.json').read_text())['sha'],
    'reference_branch':'1.20.1-forge',
    'version_limit':'OpenYSM reference branch is not the exact 1.21.1 Fabric mod used in game; runtime identity is not verified.'}
(out/'audit.json').write_text(json.dumps({'summary':summary,'clips':rows},ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# OpenYSM 动画核对记录','',
 '检查对象：用户提供的 01_taisho_maid，全部 103 个配置引用的源动作。',
 '参考 OpenYSM 1.20.1-forge，commit '+summary['reference_commit']+'。此代码并非游戏所用 1.21.1 Fabric 的精确版本，不能据此保证完整运行时一致。','',
 '已修正：hold_on_last_frame 模式；Catmull-Rom 首尾使用相邻端点而非循环绕回；pre/post 分开用于进入和离开关键帧；合法的 condition ? value 简写；true/false 常量。','',
 '保持末帧的动作：'+', '.join(summary['hold_clips']),
 '此次采样检测到曲线值改变的动作：'+', '.join(summary['curve_changed_clips']),
 '仍有无法解析的源表达式的动作：'+', '.join(summary['remaining_expression_error_clips']), '',
 '未复现的运行时逻辑：pre_parallel/main/parallel 顺序和混合；pre_parallel2 的动态 blend_weight；parallel3/4 初始化和积分脚本；idle 的随机切换；视角、速度、持物等上下文；事件、声音、粒子。',
 '缺少几何骨骼的引用列在每个动作下；不会猜测改绑到名字相近的骨骼。第一人称 fp.arm 的 parallel0 同名引用被保留为审计项，当前人形第三人称输出沿用 main 的 parallel0。','',
 '| 动作 | 循环模式 | 改变的曲线数 | 状态变量数 | 脚本事件数 | 缺失骨骼数 | 表达式错误数 |',
 '|---|---|---:|---:|---:|---:|---:|']
lines += [f"| {r['name']} | {r['loop']} | {len(r['corrected_curve_tracks'])} | {len(r['variables'])} | {r['timeline_events']} | {len(r['missing_geometry_bones'])} | {len(r['expression_errors'])} |" for r in rows]
(out/'AUDIT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
