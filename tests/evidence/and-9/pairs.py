"""Keep raw whole-screen pixels. Pair only captures from the same synthetic scenario."""
from pathlib import Path
from PIL import Image
import json

root=Path(__file__).parent
(root/'pairs').mkdir(exist_ok=True)
scenes=['settings-home','general','services','services-empty','model-menu-selected','add-service']
captions={
 'settings-home':('同一分类注册表、同一合成账户与当前主题。','原生分组触控和返回位置；深色按指定中性灰。','其他分类保留准确原页入口，未宣称所有设置已迁完。'),
 'general':('系统状态、通知、同步、连接与更新入口齐全。','首页与常规列表原生显示，避免误入关于。','运行记录、更新和备用界面沿原功能入口。'),
 'services':('服务名字、地址、型号数量与查询结果相同。','原生卡片推入编辑页，键值与库继续复用。','账户云模型留在顶栏更多，手机服务也有独立入口。'),
 'services-empty':('同样没有服务；保留添加与下一步说明。','原生空状态和重试，不显示技术错误代码。','本组无缺少的操作。'),
 'model-menu-selected':('相同已选型号、目录、当前勾选与全部模型搜索。','菜单在同一窗口，草稿与焦点保持；深色改为中性灰磨砂。','模拟器输入法零高度，真实键盘和手势区留真机确认。'),
 'add-service':('相同预设、服务名、地址、接口、密钥与查询流程。','原生表单支持自动默认、显示型号、手填与删除确认。','密钥与无目录提示分别提供；本组功能入口齐全。')}
html=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AND-9 原网页与原生对比</title><style>body{font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 20px}img{width:100%;height:auto}figure{margin:40px 0}p{line-height:1.65}.labels{display:flex;justify-content:space-around;font-weight:bold}</style><h1>原网页（左）与原生（右）</h1><p>同一合成账号、相同数据、相同逻辑宽度和页面主题。原图为 MuMu 整屏 720×1280，未重绘系统栏。深色左侧保留真实旧网页配色，右侧按本人指定中性灰规范。</p>']
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
for report_file in ['native-report.json','bars-report.json']:
 report=json.loads((root/report_file).read_text(encoding='utf-8-sig'))
 for shot in report['screenshots']:capture_metadata[shot['file']]=shot
for file in sorted(root.glob('and9-*.png')):
 im=Image.open(file).convert('RGB');status=im.getpixel((im.width//2,5));header=im.getpixel((5,100))
 bars.append({**capture_metadata.get(file.name,{}),'file':file.name,'physicalSize':list(im.size),'logicalSize':[int(file.name.split('-')[1]),round(im.height*int(file.name.split('-')[1])/im.width)],'statusBackgroundRGB':list(status),'headerBackgroundRGB':list(header),'meanChannelDifference':sum(abs(a-b) for a,b in zip(status,header))/3,'bottomSystemNavigation':'not visible in this MuMu instance; real-device gesture area unverified'})
(root/'system-bars.json').write_text(json.dumps(bars,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pairs':len(scenes)*2,'rawScreenshots':len(bars),'maxStatusHeaderChannelDifference':max(r['meanChannelDifference'] for r in bars)},ensure_ascii=False))
