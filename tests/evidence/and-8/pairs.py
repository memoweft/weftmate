"""AND-6 evidence convention: same-account raw whole-screen pairs and system-bar samples."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

root=Path(__file__).parent
(root/'pairs').mkdir(exist_ok=True)
scenes=['content','empty','calendar-open','sleep-detail','trend-overlay','analysis-open']
captions={
 'content':('今日解读、六项分数、日期和来源数字相同。','图表与页面原生绘制；深色按指定中性灰磨砂。','真实手机健康来源接入、底部系统手势区仍需真机确认。'),
 'empty':('同一接入说明、iPhone 接入步骤与三张明确标为示意的卡片。','手机没有电脑或健康来源时也正常显示，不报故障。','真实健康来源接入属于采集工作包；本页功能没有遗漏。'),
 'calendar-open':('前后月、自然日、运动标记、禁用未来日期及选中日相同。','原生44点按区，选日期后读取当日并关闭月历。','底部系统手势区与字体放大留本人真机确认。'),
 'sleep-detail':('睡眠分数、实际与目标睡眠条、对比和分期来自同一回执。','时长写“7 小时 46 分”，不写“466 分钟”；原生页面与图表。','可选“原网页详情”仍打开准确日期／指标；本页现有详情均已原生。'),
 'trend-overlay':('同一天、睡眠时长、14天、缺测断线、平时范围带、平均与深夜使用柱相同。','时长统一按小时／分表达，点图与读屏可查看每日值，筛选直接一排点。','横向筛选和图表点选手势需本人真机确认；原网页详情入口保留。'),
 'analysis-open':('相同按需开关、分析正文、依据和接着问它入口。','分析缓存重复展开不再生成，引用只进入主对话草稿、不自动发送。','模型实际生成与真机来源数据由既有健康功能验收；本包使用合成统计回执。')}
html=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AND-8 原网页与原生对比</title><style>body{font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 20px}img{width:100%;height:auto}figure{margin:40px 0}p{line-height:1.65}.labels{display:flex;justify-content:space-around;font-weight:bold}</style><h1>原网页（左）与原生（右）</h1><p>同一合成账号、同样健康数据、同一日期和主题；实际 HybridActivity 与 NativeActivity 整屏。深色左侧保留实际网页绿色，右侧按本人指定中性灰磨砂。仅改变隔离包逻辑宽度，没有修改模拟器设置。</p>']
for theme in ['light','dark']:
 for scene in scenes:
  left=root/f'and8-390-{theme}-web-{scene}.png';right=root/f'and8-390-{theme}-{scene}.png'
  a=Image.open(left).convert('RGB');b=Image.open(right).convert('RGB');assert a.size==b.size
  pair=Image.new('RGB',(a.width+b.width,a.height));pair.paste(a,(0,0));pair.paste(b,(a.width,0));file=f'{theme}-{scene}.png';pair.save(root/'pairs'/file)
  same,better,gap=captions[scene]
  html+=[f'<figure><h2>{theme} · {scene}</h2><div class="labels"><span>原网页</span><span>原生</span></div><img src="pairs/{file}" alt="{theme} {scene} 并排图"><figcaption><p>一致：{same}</p><p>故意更好：{better}</p><p>还差：{gap}</p></figcaption></figure>']
(root/'pairs.html').write_text('\n'.join(html)+ '</html>',encoding='utf-8')
metadata={}
for report_file in ['native-report.json','comparison-report.json','font-scale-report.json','postmerge-report.json']:
 if (root/report_file).exists():
  for shot in json.loads((root/report_file).read_text(encoding='utf-8'))['screenshots']:metadata[shot['file']]=shot
bars=[]
for file in sorted(root.glob('and8-*.png')):
 if 'diagnostic' in file.name:continue
 im=Image.open(file).convert('RGB');status=im.getpixel((im.width//2,5));header=im.getpixel((5,100))
 bars.append({**metadata.get(file.name,{}),'file':file.name,'physicalSize':list(im.size),'logicalSize':[int(file.name.split('-')[1]),round(im.height*int(file.name.split('-')[1])/im.width)],'statusBackgroundRGB':list(status),'headerBackgroundRGB':list(header),'meanChannelDifference':sum(abs(a-b) for a,b in zip(status,header))/3,'bottomSystemNavigation':'not visible in this MuMu instance; real-device gesture area unverified'})
(root/'system-bars.json').write_text(json.dumps(bars,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Compact sheet for batched QA; deliverable pairs retain original pixels.
sheet=Image.new('RGB',(360*4,320*3))
for i,file in enumerate(sorted((root/'pairs').glob('*.png'))):
 im=Image.open(file).convert('RGB');im.thumbnail((360,640));sheet.paste(im,((i%4)*360,(i//4)*320))
sheet.save(root/'comparison-sheet.jpg')
print(json.dumps({'pairs':len(scenes)*2,'rawScreenshots':len(bars),'maxStatusHeaderChannelDifference':max(r['meanChannelDifference'] for r in bars)}))
