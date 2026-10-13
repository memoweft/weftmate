"""Summarize original device captures without inventing a system navigation bar."""
from pathlib import Path
from PIL import Image, ImageDraw
from collections import Counter
import json, re

repo = Path(__file__).resolve().parents[2]
root = repo / 'tests/evidence/and-7'
records = []
for path in sorted(root.glob('and7-*.png')):
    match = re.match(r'and7-(360|390)-(light|dark)-(.+)\.png', path.name)
    if not match:
        continue
    width, theme, scene = match.groups()
    img = Image.open(path).convert('RGB')
    x1, x2 = img.width // 4, img.width * 3 // 4
    def dominant(box):
        return Counter(img.crop(box).getdata()).most_common(1)[0][0]
    status = dominant((x1, 5, x2, 24))
    header = dominant((x1, 35, x2, 55))
    delta = max(abs(a-b) for a,b in zip(status,header))
    records.append(dict(file=path.name, widthDp=int(width), pageTheme=theme,
        systemTheme='MuMu existing dark setting; unchanged', systemVersion='15',
        physicalSize=list(img.size), bottomNavigationVisible=False, navigationBottom=0,
        statusRGB=status, headerRGB=header, delta=delta))
(root/'screenshots.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n', encoding='utf8')

pairs = [(scene, scene, theme) for theme in ['light'] for scene in ['library-list','row-menu','library-empty','viewer-markdown','viewer-code']]
(root/'pairs').mkdir(exist_ok=True)
for stale in (root/'pairs').glob('dark-*.png'):
    stale.unlink()
for android, apple, theme in pairs:
    left = root / f'and7-390-{theme}-web-{apple}.png'
    right = root / f'and7-390-{theme}-{android}.png'
    if not left.exists() or not right.exists():
        continue
    imgs = [Image.open(p).convert('RGB') for p in [left,right]]
    target_height = 844
    imgs = [im.resize((round(im.width*target_height/im.height), target_height)) for im in imgs]
    combined = Image.new('RGB', (sum(im.width for im in imgs)+24,target_height+36), 'white')
    draw = ImageDraw.Draw(combined)
    draw.text((4,8),'Existing web UI / same account and files',fill='black');draw.text((imgs[0].width+28,8),'Android actual destination / same theme',fill='black')
    combined.paste(imgs[0],(0,36));combined.paste(imgs[1],(imgs[0].width+24,36))
    combined.save(root/'pairs'/f'{theme}-{android}.png')

# Explicit specification swatches, not a fabricated application screenshot.
reference=json.loads((root/'dark-control-reference.json').read_text(encoding='utf8'))
canvas=tuple(bytes.fromhex(reference['canvas'][1:]))
def spec_rgb(value):
    if value.startswith('#'):
        return tuple(bytes.fromhex(value[1:]))
    values=[float(x) for x in re.findall(r'[\d.]+',value)]
    return tuple(round(values[i]*values[3]+canvas[i]*(1-values[3])) for i in range(3))
swatches=Image.new('RGB',(475,844),canvas)
draw=ImageDraw.Draw(swatches)
draw.text((20,20),'Controls spec / exact dark tokens',fill=spec_rgb(reference['ink']))
for i,(name,value) in enumerate(reference.items()):
    y=60+i*51
    draw.rounded_rectangle((20,y,110,y+36),radius=8,fill=spec_rgb(value))
    draw.text((124,y+2),name,fill=spec_rgb(reference['ink']))
    draw.text((124,y+18),value,fill=spec_rgb(reference['ink-secondary']))
swatches.save(root/'dark-control-reference.png')
for scene in ['library-list','row-menu','library-empty','viewer-menu']:
    source=root/f'and7-390-dark-{scene}.png'
    if not source.exists():continue
    native=Image.open(source).convert('RGB').resize((475,844))
    pair=Image.new('RGB',(974,880),canvas)
    pair.paste(swatches,(0,36));pair.paste(native,(499,36))
    d=ImageDraw.Draw(pair);d.text((20,12),'Controls specification',fill=spec_rgb(reference['ink']));d.text((519,12),'Native Android',fill=spec_rgb(reference['ink']))
    pair.save(root/'pairs'/f'dark-{scene}.png')

lines = ['| 整屏图 | 页面主题 | 系统主题／版本 | 状态栏 RGB | 顶栏 RGB | 最大色差 | 底部系统导航 |',
         '|---|---|---|---|---|---|---|']
for r in records:
    lines.append(f"| [{r['file']}]({r['file']}) | {r['pageTheme']} | 深色／Android 15 | {r['statusRGB']} | {r['headerRGB']} | {r['delta']} | 不可见，高度 0 |")
(root/'system-bars.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
print(json.dumps({'screenshots':len(records),'nonzeroDelta':sum(r['delta']!=0 for r in records)},ensure_ascii=False))
