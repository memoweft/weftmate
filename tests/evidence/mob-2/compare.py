"""Compose unmodified acceptance captures and measure desktop/system-bar differences."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFont

root = Path(__file__).parent
pairs = root / 'pairs'
pairs.mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
rows, desktop = [], []
for after in sorted((root / 'after').glob('*.png')):
    before = root / 'before' / after.name
    if not before.exists() or 'failure' in after.name:
        continue
    left, right = Image.open(before).convert('RGB'), Image.open(after).convert('RGB')
    assert left.size == right.size, after.name
    width, height = left.size
    canvas = Image.new('RGB', (width * 2 + 16, height + 48), '#f1f2f4')
    draw = ImageDraw.Draw(canvas)
    draw.text((16, 8), '改之前', font=font, fill='#20232a')
    draw.text((width + 32, 8), '改之后', font=font, fill='#20232a')
    canvas.paste(left, (0, 48))
    canvas.paste(right, (width + 16, 48))
    canvas.save(pairs / after.name)
    rows.append(after.name)
    if after.name.startswith('electron-'):
        diff = ImageChops.difference(left, right)
        pixels = list(diff.getdata())
        desktop.append({'file': after.name, 'changedPixels': sum(any(pixel) for pixel in pixels),
                        'totalPixels': width * height, 'maximumChannelDifference': max(max(pixel) for pixel in pixels)})

systems = []
for phase in ['before', 'after']:
    meta = root / phase / 'system-bar-checks.json'
    if not meta.exists():
        continue
    for entry in json.loads(meta.read_text(encoding='utf-8'))['checks']:
        picture = Image.open(root / phase / entry['file']).convert('RGB')
        width, height = picture.size
        status = picture.getpixel((5, max(1, entry['statusHeight'] // 2)))
        top = picture.getpixel((5, entry['statusHeight'] + 8))
        navigation = picture.getpixel((5, height - max(1, entry['navigationHeight'] // 2))) if entry['navigationHeight'] else None
        systems.append({'phase': phase, **entry, 'statusBarRGB': status, 'pageTopRGB': top,
                        'navigationBarRGB': navigation,
                        'maximumChannelDifference': max(abs(a-b) for a,b in zip(status,top))})
report = {'pairs': len(rows), 'desktop': desktop, 'systemBars': systems, 'rawScreensUnmodified': True}
(root / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
index = ['# MOB-2 前后对照', '', '每张左侧为改之前，右侧为改之后。原始图在 before / after；系统整屏没有裁切或改色。', '', '| 场景 | 并排图 | 改前原图 | 改后原图 |', '|---|---|---|---|']
for name in rows:
    index.append(f'| {name} | [对照](pairs/{name}) | [原图](before/{name}) | [原图](after/{name}) |')
(root / 'SCREENSHOTS.md').write_text('\n'.join(index)+'\n', encoding='utf-8')
print(json.dumps({'pairs': len(rows), 'desktop': desktop, 'systemColorDifferences': [row['maximumChannelDifference'] for row in systems]}, ensure_ascii=False))
