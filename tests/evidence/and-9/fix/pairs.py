"""Keep raw whole-screen pixels. Pair only captures from the same synthetic scenario."""
from pathlib import Path
from PIL import Image
import json

root=Path(__file__).parent
(root/'pairs').mkdir(exist_ok=True)
scenes=['settings-home','general','services','account','devices','appearance']
captions={
 'settings-home':('暖灰无描边卡片、头像账户卡、卡外真实用量、胶囊搜索、分类图标与行密度。','原生触控、滚动与返回；深色按指定中性灰。','本次要求的首页样式已补齐。'),
 'general':('常规标题、此设备分组、各入口与说明；同样使用暖灰实底和圆角。','原生列表点击与返回；去掉原生旧版额外重复的备用界面入口。','本次要求的卡片与列表样式已补齐；具体系统工具沿原网页入口。'),
 'services':('模型服务标题、说明、服务名、地址、型号数量、查询状态与更多入口。','原生卡片与编辑切页；本次依本人要求也改用无描边实底。','本次要求的卡片与顶栏已补齐；新增服务表单仍是原包已验收的原生流程。'),
 'account':('我的资料、头像、昵称、账户资料、保存与更换头像、账户保护。','原生表单与同一窗口确认；深色中性灰。','本次要求的卡片已补齐；头像选择与完整账户保护沿原网页入口。'),
 'devices':('相同合成账号设备、当前设备标注、有效期、连接说明与管理入口。','原生设备详情及改名／移除；多电脑行为保留原包独立验证。','本次要求的卡片与设备列表已补齐；配对沿原网页入口。'),
 'appearance':('颜色模式三幅预览、减少动态效果、字号与代码字号入口的顺序和说明。','原生选项、轻提示与滚动；深色预览使用规范中性灰。','本次要求的实底卡片与预览已补齐；强调色沿原网页实际控件。')}
html=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AND-9 返修：原网页与原生对比</title><style>body{font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 20px}img{width:100%;height:auto}figure{margin:40px 0}p{line-height:1.65}.labels{display:flex;justify-content:space-around;font-weight:bold}</style><h1>原网页（左）与原生（右）</h1><p>同一合成账号、相同数据、相同逻辑宽度和页面主题。原图为 MuMu 整屏 720×1280，未重绘系统栏。深色左侧保留真实旧网页配色，右侧按本人指定中性灰规范。</p>']
for theme in ['light','dark']:
 for scene in scenes:
  width=390
  left=root/f'and9-{width}-{theme}-web-{scene}.png';right=root/f'and9-{width}-{theme}-{scene}.png'
  if not left.exists() or not right.exists():raise RuntimeError(f'Missing final pair: {theme}/{scene}')
  a=Image.open(left).convert('RGB');b=Image.open(right).convert('RGB')
  assert a.size==b.size
  pair=Image.new('RGB',(a.width+b.width,a.height));pair.paste(a,(0,0));pair.paste(b,(a.width,0));file=f'{theme}-{scene}.png';pair.save(root/'pairs'/file)
  same,better,gap=captions[scene]
  html += [f'<figure><h2>{theme} · {scene}</h2><div class="labels"><span>原网页</span><span>原生</span></div><img src="pairs/{file}" alt="{theme} {scene} 并排图"><figcaption><p>一致：{same}</p><p>故意更好：{better}</p><p>还差：{gap}</p></figcaption></figure>']
html.append('</html>');(root/'pairs.html').write_text('\n'.join(html),encoding='utf-8')
bars=[]
capture_metadata={}
for report_file in ['native-report.json']:
 report=json.loads((root/report_file).read_text(encoding='utf-8-sig'))
 for shot in report['screenshots']:capture_metadata[shot['file']]=shot
for file in sorted(root.glob('and9-*.png')):
 im=Image.open(file).convert('RGB');status=im.getpixel((im.width//2,5));header=im.getpixel((5,100))
 bars.append({**capture_metadata.get(file.name,{}),'file':file.name,'physicalSize':list(im.size),'logicalSize':[int(file.name.split('-')[1]),round(im.height*int(file.name.split('-')[1])/im.width)],'statusBackgroundRGB':list(status),'headerBackgroundRGB':list(header),'meanChannelDifference':sum(abs(a-b) for a,b in zip(status,header))/3,'bottomSystemNavigation':'not visible in this MuMu instance; real-device gesture area unverified'})
(root/'system-bars.json').write_text(json.dumps(bars,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pairs':len(scenes)*2,'rawScreenshots':len(bars),'maxStatusHeaderChannelDifference':max(r['meanChannelDifference'] for r in bars)},ensure_ascii=False))
