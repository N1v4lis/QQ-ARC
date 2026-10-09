from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent
brand=root/'app/ui/assets/brand';brand.mkdir(parents=True,exist_ok=True)
(brand/'qqaf-icon.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="42" fill="#4176e6"/><path d="M48 72 92 40 108 116 148 116 164 40 208 72 196 164 128 216 60 164Z" fill="#f9fcff"/><path d="M60 75 86 58 98 101Z M196 75 170 58 158 101Z" fill="#b7d4ff"/><path d="M72 130 103 148 86 151Z M184 130 153 148 170 151Z" fill="#253f82"/><path d="M116 176 140 176 128 188Z" fill="#253f82"/></svg>''',encoding='utf-8')
n=1024;im=Image.new('RGBA',(n,n),(0,0,0,0));d=ImageDraw.Draw(im)
def pts(values):return [(round(x*n/256),round(y*n/256)) for x,y in values]
d.rounded_rectangle((32,32,992,992),radius=168,fill='#4176e6')
d.polygon(pts([(48,72),(92,40),(108,116),(148,116),(164,40),(208,72),(196,164),(128,216),(60,164)]),fill='#f9fcff')
for values in [[(60,75),(86,58),(98,101)],[(196,75),(170,58),(158,101)]]:d.polygon(pts(values),fill='#b7d4ff')
for values in [[(72,130),(103,148),(86,151)],[(184,130),(153,148),(170,151)],[(116,176),(140,176),(128,188)]]:d.polygon(pts(values),fill='#253f82')
im.resize((256,256),Image.Resampling.LANCZOS).save(root/'flutter/windows/runner/resources/app_icon.ico',sizes=[(n,n) for n in [16,24,32,48,64,128,256]])
paths={0:'<path d="M4 17a9 9 0 1 1 16 0M12 13l5-5M5 18h14"/>',1:'<path d="M4 4h16v12H9l-5 4V4Z"/>',6:'<path d="M4 7h16v13H4ZM3 3h18v4M9 11h6"/>',4:'<path d="M12 4c-5-5-10 3-7 6-4 4 1 11 7 8 6 3 11-4 7-8 3-3-2-11-7-6ZM12 4v14M6 7l3 2M18 7l-3 2M5 13l4-1M19 13l-4-1"/>',7:'<path d="M4 20V11h4v9M10 20V6h4v14M16 20V3h4v17"/>',8:'<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9" r="3"/><path d="M7 17c0-5 10-5 10 0"/>',9:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',10:'<path d="M4 4h6c-3 8 7 8 4 0h6v6c-8-3-8 7 0 4v6h-6c3-8-7-8-4 0H4v-6c8 3 8-7 0-4V4Z"/>',11:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-3c0-6 12-6 12 0v3M16 4a3 3 0 0 1 0 6M18 13c4 0 4 3 4 7"/>',2:'<path d="m9 3-1 3-3 1-2 4 2 4 3 1 1 3h6l1-3 3-1 2-4-2-4-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',18:'<path d="M3 9 5 3h14l2 6M3 9c0 5 5 5 5 0 0 5 8 5 8 0 0 5 5 5 5 0M5 13v8h14v-8M10 21v-6h4v6"/>'}
out=root/'app/ui/assets/default-icons';out.mkdir(parents=True,exist_ok=True)
for id,body in paths.items():
 (out/(str(id)+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#81858c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+body+'</g></svg>',encoding='utf-8')
print('Generated brand ICO sizes 16–256 and 11 original default navigation icons.')
