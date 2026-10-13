"""Join unmodified full-screen captures: existing web on left, native on right."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
target = root / "pairs"
target.mkdir(exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24)
sections = []
for theme in ("light",):
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
        sections.append(f'<section><h2>{theme} · {label}</h2><img src="pairs/{name}" alt="左网页右原生，{label}"><p>一致：同一合成账号、同一数据与主题，保留正文、五类筛选、行菜单和原有操作；尺寸按当前控件规范统一。</p><p>更好：原生滚动、下拉刷新和点击反馈；待处理靠前，时间说人话。五个互斥筛选按规范收进同一菜单，当前项带勾。</p><p>还差：复杂记忆编辑／删除、报告完整操作、成果预览与设置详情在本包继续使用原网页，原位保留入口；底部系统手势条在此模拟器不可见，真机边界留统一验收。</p></section>')
for state, control in (("list-unread-pending", "button"), ("empty", "iconbutton"), ("row-menu", "menu")):
    reference = Image.open(root / f"spec-{control}-dark.png").convert("RGB")
    native = Image.open(root / f"and5-390-dark-{state}.png").convert("RGB")
    pair = Image.new("RGB", (reference.width + native.width + 24, max(reference.height, native.height) + 48), "#1c1c1e")
    draw = ImageDraw.Draw(pair)
    draw.text((8, 8), "Controls spec / dark", font=font, fill="#f2f2f4")
    draw.text((reference.width + 32, 8), "Native / 390 / dark", font=font, fill="#f2f2f4")
    pair.paste(reference, (0, 48)); pair.paste(native, (reference.width + 24, 48))
    name = f"dark-{state}.png"; pair.save(target / name)
    sections.append(f'<section><h2>深色 · {state}</h2><img src="pairs/{name}" alt="左控件规范深色预览右原生"><p>一致：左图直接渲染 controls-spec 的深色预览与令牌；右图是本包原生整屏。页面、卡片、文字和浮面板的取值见颜色核对表。</p><p>更好：菜单使用安卓系统背景模糊；文字保持清晰。滚动内容自身不模糊，关闭菜单还原窗口属性。</p><p>还差：原网页复杂详情保留旧主题，因为本包不改网页；相应入口已保留。安卓窗口模糊的真实范围是菜单后面的整屏背景；不冒称局部模糊。</p></section>')
(root / "pairs.html").write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>动态：网页与原生对比</title><style>body{margin:24px;background:#eee;color:#222;font:16px system-ui}img{display:block;width:100%;max-width:1464px}p{line-height:1.7}section{margin:36px 0}</style><h1>动态：网页与原生对比</h1><p>左边是原 HybridActivity（网页界面）在独立测试包里的整屏图，右边是原生。只增加测试包的逻辑宽度，没有改变网页代码；两边登录同一合成账号，使用同一固定活动快照与主题。原始图保留状态栏，拼接未裁切、未改像素。</p>''' + '\n'.join(sections) + '</html>', encoding="utf-8")
print(f"Created {len(sections)} light web/native and dark spec/native pairs")
