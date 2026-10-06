"""Numeric checks for the concrete runtime semantics corrected during the audit."""
import ast, math,re,bisect,functools
from pathlib import Path
from types import SimpleNamespace
import numpy as np
namespace={'np':np,'math':math,'re':re,'bisect':bisect,'functools':functools,
           'unknown':set(),'errors':set(),'options':SimpleNamespace(openysm=True)}
tree=ast.parse(Path('convert_winefox_animated.py').read_text(encoding='utf-8'))
selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('parse','evaluate','sample')
    or isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('TOKEN','PRECEDENCE') for t in node.targets)]
exec(compile(ast.Module(body=selected,type_ignores=[]),'runtime-functions','exec'),namespace)
evaluate=namespace['evaluate']; sample=namespace['sample']
assert evaluate('true',{})==1 and evaluate('false',{})==0
assert evaluate('1 ? 7',{})==7 and evaluate('0 ? 7',{})==0
assert evaluate('1 ? 0 ? 2 : 3 : 4',{})==3
assert evaluate('0 ? 2 : 1 ? 3 : 4',{})==3
assert evaluate('12.5-(q.ground_speed>0?math.sin(-120+query.anim_time*720)*3)',{'query.ground_speed':0,'query.anim_time':.25})==12.5
def key(t,post,pre=None):
    k={'time':t,'interpolation':'catmullrom','data_points':[dict.fromkeys(('x','y','z'),str(post))]}
    if pre is not None: k['pre_data_point']=dict.fromkeys(('x','y','z'),str(pre))
    return k
# OpenYSM EasingType clamps the first/last control point, even on looped clips.
assert np.allclose(sample([key(0,0),key(1,10),key(2,30)],.5,{},'rotation',True),3.75)
keys=[key(0,5,0),key(1,20,10)]
for k in keys: k['interpolation']='linear'
assert np.allclose(sample(keys,.5,{},'position',False),7.5)
assert np.allclose(sample(keys,1,{},'position',False),20)
assert not namespace['errors'],namespace['errors']
print('OpenYSM semantics checks passed: literals, conditional shorthand/nesting, clamped curve endpoints, pre/post discontinuities.')
