"""Join unmodified full-screen captures: existing web on left, native on right."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
target = root / "pairs"
target.mkdir(exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24)
sections = []
for theme in ("light", "dark"):
    for state, label in (("list-unread-pending", "有内容／未读与待处理"), ("empty", "空"), ("row-menu", "菜单打开")):
        web = Image.open(root / f"and5-390-{theme}-web-{state}.png").convert("RGB")
        native = Image.open(root / f"and5-390-{theme}-{state}.png").convert("RGB")
        assert web.size == native.size, "Same logical width and emulator surface are required"
        width, height = web.size
        pair = Image.new("RGB", (width * 2 + 24, height + 48), "#eeeeee")
        draw = ImageDraw.Draw(pair)
        draw.text((8, 8), f"Web / 390 / {theme}", font=font, fill="#222222")
        draw.text((width + 32, 8), f"Native / 390 / {theme}", font=font, fill="#222222")
        pair.paste(web, (0, 48))
        pair.paste(native, (width + 24, 48))
        name = f"{theme}-{state}.png"
        pair.save(target / name)
        sections.append(f'<section><h2>{theme} · {label}</h2><img src="pairs/{name}" alt="左网页右原生，{label}"><p>一致：同一合成账号、同一数据与主题，保留信息顺序、五类筛选、行菜单和原有操作。</p><p>更好：原生滚动、下拉刷新、点击反馈；待处理靠前，时间使用今天／昨天等说法；按钮按本人要求只显示图标。</p><p>还差：复杂记忆编辑／删除、报告完整操作、成果预览与设置详情仍为原网页，均保留入口；其余页面能力无缺失。底部系统手势条在此模拟器不可见，真机边界留统一验收。</p></section>')
(root / "pairs.html").write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>动态：网页与原生对比</title><style>body{margin:24px;background:#eee;color:#222;font:16px system-ui}img{display:block;width:100%;max-width:1464px}p{line-height:1.7}section{margin:36px 0}</style><h1>动态：网页与原生对比</h1><p>左边是原 HybridActivity（网页界面）在独立测试包里的整屏图，右边是原生。只增加测试包的逻辑宽度，没有改变网页代码；两边登录同一合成账号，使用同一固定活动快照与主题。原始图保留状态栏，拼接未裁切、未改像素。</p>''' + '\n'.join(sections) + '</html>', encoding="utf-8")
print(f"Created {len(sections)} web/native pairs")
