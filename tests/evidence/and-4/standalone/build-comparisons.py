"""Arrange unmodified full-screen captures; never synthesize UI evidence."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 30)
labels = {"empty": "空对话", "content": "同一段对话", "menu": "模型菜单"}
for theme in ("light",):
    for state, label in labels.items():
        web = Image.open(root / f"native-390-{theme}-compare-web-{state}.png").convert("RGB")
        native = Image.open(root / f"native-390-{theme}-compare-native-{state}.png").convert("RGB")
        assert web.size == native.size
        width, height = web.size
        sheet = Image.new("RGB", (width * 2, height + 250), "#faf9f7")
        sheet.paste(web, (0, 60)); sheet.paste(native, (width, 60))
        draw = ImageDraw.Draw(sheet)
        draw.text((22, 12), f"网页 · {label} · {theme}", font=title, fill="#272724")
        draw.text((width + 22, 12), f"原生 · 同账号 / 同数据 / 同主题", font=title, fill="#272724")
        lines = [
            "一致：同一会话与模型；浅色墨色、软底、图标入口、圆角及阅读密度沿用网页。",
            "故意更好：原生点按反馈、输入高度过渡、切页淡入、生成时跟随底部。",
            "还差（本包边界）：复杂渲染与完整操作留后续包；「完整对话功能 / 列表」打开原网页。",
        ]
        for index, line in enumerate(lines):
            draw.text((22, height + 84 + index * 46), line, font=font, fill="#272724")
        sheet.save(root / f"comparison-{theme}-{state}.png")

# The left side is an explicitly labelled token reference, never a fabricated app capture.
import json
tokens = json.loads((root.parents[3] / "design/tokens/tokens.json").read_text(encoding="utf-8"))["android"]["darkColors"]
def composite(value):
    alpha = int(value[1:3], 16) / 255
    rgb = [int(value[i:i+2], 16) for i in (3,5,7)]
    return tuple(round(c * alpha + b * (1-alpha)) for c,b in zip(rgb,(28,28,30)))

for state, label in labels.items():
    native = Image.open(root / f"native-390-dark-compare-native-{state}.png").convert("RGB")
    width,height = native.size
    sheet = Image.new("RGB", (width*2,height+250), "#1c1c1e")
    sheet.paste(native,(width,60)); draw=ImageDraw.Draw(sheet)
    draw.text((22,12),"深色控件规范 · 色值参考",font=title,fill="#f2f2f4")
    draw.text((width+22,12),f"原生实拍 · {label}",font=title,fill="#f2f2f4")
    for index,key in enumerate(("canvas","surface","soft","surfaceFloat","selectedOnSoft","ink","secondary","muted","accent","onAccent","accentSoft","danger","line")):
        y=90+index*85
        draw.rounded_rectangle((22,y,160,y+58),radius=12,fill=composite(tokens[key]),outline="#a3a3a9")
        draw.text((180,y+6),f"{key}: {tokens[key]}",font=font,fill="#f2f2f4")
    lines=["一致：指定中性灰与透明度；页面、卡片、输入底、浮层、字色与主按钮逐项核对。",
           "故意更好：固定面板只模糊背景，按钮与文字清晰；滚动与键盘按原生安全区布局。",
           "还差（本包边界）：四页、设置、文件原生查看与复杂操作留后续包，原网页入口保留。"]
    for index,line in enumerate(lines):draw.text((22,height+84+index*46),line,font=font,fill="#f2f2f4")
    sheet.save(root / f"comparison-dark-spec-{state}.png")
