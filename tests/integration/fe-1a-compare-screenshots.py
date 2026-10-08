"""Compare the captured real-program baseline and current UI without masking any pixels."""
import json
from pathlib import Path
from PIL import Image, ImageChops

evidence = Path(__file__).resolve().parents[2] / 'tests' / 'evidence' / 'fe-1a'
pairs = []
for before in sorted(evidence.glob('before-*.png')):
    after = before.with_name(before.name.replace('before-', 'after-', 1))
    with Image.open(before) as original, Image.open(after) as current:
        a, b = original.convert('RGBA'), current.convert('RGBA')
        if a.size != b.size:
            raise AssertionError(f'{before.stem}: image size changed from {a.size} to {b.size}')
        difference = ImageChops.difference(a, b)
        changed = sum(1 for pixel in difference.get_flattened_data() if any(pixel))
        pairs.append({'flow': before.stem.removeprefix('before-'), 'width': a.width,
                      'height': a.height, 'changedPixels': changed})
if not pairs:
    raise AssertionError('No baseline screenshots found')
report = {'comparison': 'exact RGBA pixels; no masks',
          'allIdentical': all(pair['changedPixels'] == 0 for pair in pairs), 'pairs': pairs}
(evidence / 'screenshot-comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if not report['allIdentical']:
    raise AssertionError('A screenshot changed')
