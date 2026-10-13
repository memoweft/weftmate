"""Keep raw whole-screen pixels. Pair only captures from the same synthetic scenario."""
from pathlib import Path
from PIL import Image
import json

root=Path(__file__).parent
(root/'pairs').mkdir(exist_ok=True)
scenes=['content','empty','row-menu','new-form','feed-filters','library-filters']
captions={
 'content':('三个区块、任务内容、来源对话与状态相同。','原生整行打开详情，提供一排直接点选；深色按中性灰规范。','等电脑上线的事项保留「完整目标功能」原网页入口。'),
 'empty':('保留各区块的图标、说明和下一步入口。','骨架与错误重试在原生页完成，手机单独使用不会报故障。','无电脑的真机登录链路由手机独立包验收，本包验证已有手机身份进入。'),
 'row-menu':('编辑、立即运行、来源对话与红色删除均在行菜单。','增加原生执行记录入口；删除需要二次确认。','复杂来源对话操作仍有原网页入口。'),
 'new-form':('做什么、所属对话、到点做什么、重复与时间规则相同。','原生保存按钮固定，表单滚动和键盘内缩沿应用安全区。','长期目标编辑与检查点调整沿来源对话；现有契约没有独立编辑接口。'),
 'feed-filters':('全部／待处理／任务／提醒／记忆都是一排直接点选。','超过可见宽度时横向滑动，当前项有圆角底与读屏选中态。','真机字体放大与手势条需本人确认；原复杂动作入口继续保留。'),
 'library-filters':('全部／文档／表格／图片／代码／其它回到同一排；项目、时间仍是下拉。','三页共用同一个筛选组件，溢出横向滑动。','文件查看能力沿已合并成果库包，本包只改筛选。')}
html=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AND-6 原网页与原生对比</title><style>body{font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 20px}img{width:100%;height:auto}figure{margin:40px 0}p{line-height:1.65}.labels{display:flex;justify-content:space-around;font-weight:bold}</style><h1>原网页（左）与原生（右）</h1><p>同一合成账号、相同数据、相同逻辑宽度和页面主题。原图为 MuMu 整屏 720×1280，未重绘系统栏。深色左侧保留真实旧网页配色，右侧按本人指定中性灰规范。</p>']
for theme in ['light','dark']:
 for scene in scenes:
  width=390
  left=root/f'and6-{width}-{theme}-web-{scene}.png';right=root/f'and6-{width}-{theme}-{scene}.png'
  if not left.exists() or not right.exists():raise RuntimeError(f'Missing final pair: {theme}/{scene}')
  a=Image.open(left).convert('RGB');b=Image.open(right).convert('RGB')
  assert a.size==b.size
  pair=Image.new('RGB',(a.width+b.width,a.height));pair.paste(a,(0,0));pair.paste(b,(a.width,0));file=f'{theme}-{scene}.png';pair.save(root/'pairs'/file)
  same,better,gap=captions[scene]
  html += [f'<figure><h2>{theme} · {scene}</h2><div class="labels"><span>原网页</span><span>原生</span></div><img src="pairs/{file}" alt="{theme} {scene} 并排图"><figcaption><p>一致：{same}</p><p>故意更好：{better}</p><p>还差：{gap}</p></figcaption></figure>']
html.append('</html>');(root/'pairs.html').write_text('\n'.join(html),encoding='utf-8')
bars=[]
for file in sorted(root.glob('and6-*.png')):
 im=Image.open(file).convert('RGB');status=im.getpixel((im.width//2,5));header=im.getpixel((5,100))
 bars.append({'file':file.name,'physicalSize':list(im.size),'statusBackgroundRGB':list(status),'headerBackgroundRGB':list(header),'meanChannelDifference':sum(abs(a-b) for a,b in zip(status,header))/3,'bottomSystemNavigation':'not visible in this MuMu instance; real-device gesture area unverified'})
(root/'system-bars.json').write_text(json.dumps(bars,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pairs':len(scenes)*2,'rawScreenshots':len(bars),'maxStatusHeaderChannelDifference':max(r['meanChannelDifference'] for r in bars)},ensure_ascii=False))
