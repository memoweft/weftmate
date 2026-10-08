"""Compare the complete RGBA images without masking or cropping any pixels."""
from pathlib import Path
import json
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1] / 'evidence' / 'fe-1b'
rows = []
for before in sorted(root.glob('before-*.png')):
    after = before.with_name(before.name.replace('before-', 'after-', 1))
    if not after.exists():
        raise SystemExit(f'Missing matching image: {after.name}')
    left, right = Image.open(before).convert('RGBA'), Image.open(after).convert('RGBA')
    if left.size != right.size:
        raise SystemExit(f'Image dimensions differ: {before.name}: {left.size} / {right.size}')
    diff = ImageChops.difference(left, right)
    pixels = diff.get_flattened_data() if hasattr(diff, 'get_flattened_data') else diff.getdata()
    changed = sum(pixel != (0, 0, 0, 0) for pixel in pixels)
    rows.append({'surface': 'mumu' if '-mumu-' in before.name else 'chromium',
                 'name': before.stem.removeprefix('before-'), 'width': left.width, 'height': left.height,
                 'changedPixels': changed, 'changedPercent': round(100 * changed / (left.width * left.height), 6),
                 'changedBounds': diff.convert('RGB').getbbox(),
                 'before': before.name, 'after': after.name})
if not rows:
    raise SystemExit('No baseline screenshots found')
result = {'comparison': 'complete RGBA image, no masks or crop', 'images': rows}
(root / 'screenshot-comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'comparison': result['comparison'], 'pairs': len(rows),
                  'surfaces': {surface: {'pairs': sum(row['surface'] == surface for row in rows),
                              'identicalPairs': sum(row['surface'] == surface and row['changedPixels'] == 0 for row in rows),
                              'changedPixels': sum(row['changedPixels'] for row in rows if row['surface'] == surface)}
                               for surface in ['chromium', 'mumu']}}, ensure_ascii=False, indent=2))
