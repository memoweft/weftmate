"""Locate the sole synthetic card in the captured MuMu notification shade.

The screenshot is the actual system surface, not a fabricated app deep link.
The driver independently requires this notification's production read receipt.
"""
import json
import sys
from PIL import Image

image = Image.open(sys.argv[1]).convert("RGB")
width, height = image.size
background = image.getpixel((width // 2, height - 40))
xs = range(int(width * .04), int(width * .96), 8)
xs = list(xs)
bands, start = [], None
for y in range(int(height * .2), int(height * .85)):
    color = image.getpixel((width // 2, y))
    matches = sum(max(abs(a-b) for a,b in zip(image.getpixel((x,y)), color)) <= 2 for x in xs)
    # The observed single notification has a broad uniform neutral card surface;
    # the shade background and split quick-setting tiles do not qualify.
    card = (max(abs(a-b) for a,b in zip(color, background)) > 12
            and max(color)-min(color) < 18 and matches >= len(xs)*.72)
    if card and start is None:
        start = y
    elif not card and start is not None:
        if y-start >= height*.06:
            bands.append((start, y))
        start = None
if start is not None and int(height*.85)-start >= height*.06:
    bands.append((start, int(height*.85)))
if len(bands) != 1:
    raise RuntimeError(f"Expected one visible synthetic notification card, found {len(bands)}")
top, bottom = bands[0]
print(json.dumps({"x":width//2,"y":(top+bottom)//2,"top":top,"bottom":bottom,
                  "width":width,"height":height,"method":"actual screenshot card bounds"}))
