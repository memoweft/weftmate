import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const out='tests/evidence/bl-29';
const read=name=>JSON.parse(readFileSync(`${out}/${name}.json`,'utf8'));
const phases=['foreground-idle','streaming','background','electron-minimized','settings','activity','goals','library'];
function actor(stack,route){
  for(const [key,label]of [['currentRelease','更新提示：重绘事件'],['retryConnection','连接探测计时器'],['refreshConversationFacts','原生事实变化事件'],['refreshAssistantOverview','会话概览计时器'],['refreshAssistant','原全量刷新计时器'],['listMobileSessions','会话概览计时器'],['refreshHome','会话主页计时器'],['readGoals','目标页／徽标计时器'],['refreshActivity','动态页／徽标计时器'],['refreshPendingDevices','设备批准计时器'],['refreshCloudDevices','设备批准计时器'],['readLibrary','成果库计时器'],['refreshHistory','正文计时器'],['refreshLogicalHistory','正文计时器']])if(stack.includes(key))return label;
  if(route==='shared.outbox.list')return '会话概览：原生待确认发送';
  return stack.split(' ← ').at(-1)?.replace(/at /,'')||'页面事件';
}
function meaning(route){
  if(route.includes('updates.status'))return ['本机已安装版本','原来失败后每次重绘重试；合成桥未实现该方法。现在失败／待验证最多30秒重试一次；正常成功同身份只读一次。此方法不走中继。'];
  if(route.includes('outbox'))return ['本机待确认发送','原生本地存储读取；网络不确定时仍需恢复原请求编号，不走中继。'];
  if(/\/changes$|\/events$|shared.sessions.events/.test(route))return ['正文／原生事件增量','生成中约4次/秒必要；空闲现代主对话／旁聊等待原生事件，兼容路径1500毫秒；后台取消等待并暂停。'];
  if(/approvals|questions|\/tasks\/cmd-/.test(route))return ['决策／任务的权威回执','原来正文每次重读都连带查询；现在仅事实变化、入页、处理动作／恢复时读取，保留来源和回执核对。'];
  if(/models|personalization|memory\/status|\/usage|\/sync\/events/.test(route))return ['配置／用量／副本','原来全量计时器反复读；设置在入页／写回时读取，手机配置和记忆可用性30秒检查，用量在回合事实变化时更新。'];
  if(/pending/.test(route))return ['新设备待批准','前台15秒核对；后台暂停；必要，独立于对话正文。'];
  if(/host.status|\/status$/.test(route))return ['宿主连接／能力','原全量刷新重复查询；复用同身份状态快照，在线探测15秒、后台60秒，失败沿原分级重连。'];
  if(/activity/.test(route))return ['动态／待办徽标','同一概览计时器，当前动态页与徽标不重复读取；前台5500毫秒。'];
  if(/\/tasks$|\/goals$|\/schedules$/.test(route))return ['目标页内容','仅当前目标页计时器读取；聊天页不再后台读完整目标页。'];
  if(/library/.test(route))return ['成果库内容','仅当前成果库读取；后台暂停。'];
  if(/sessions|chats|projects/.test(route))return ['跨设备会话与项目列表','前台5500毫秒，保证6秒内看见新建／改名；设置页不读对话内容；恢复前台立即读。多个现有接口各有契约用途，本包不加聚合路由。'];
  return ['当前页面数据','完整调用链见原始JSON；按当前页面与身份保留。'];
}
const tables={};let md=`# 空闲请求计数与响应复验\n\n使用真实 Electron（桌面程序框架）与远程手机网页，沿用 STREAM-1b 的隔离合成宿主／原生日志夹具。固定 DSH（助手运行时）实际宿主＋合成 SSE（分块传输）模型另由时间线运行器验证首字和30秒请求预算。真实模型请求0；随机端口、临时目录、合成账户、电脑名 synthetic-host；未使用 MuMu，未操作本人桌面和日用数据。\n\n改前资源固定在提交 ec3ab4996609a6d81181bc178f024d5e5158c577；改后为本分支。请求创建时计数：电脑统计 /personal/v1 的 HTTP（网页传输协议）请求，手机统计所有桥方法（包含本地方法），不把同一桥调用下游请求再计一次。注入读取调用栈，按路由／方法×调用方合并；JSON（结构化数据）保留完整调用链。前台空闲稳定61秒；流式30秒；hidden（不可见）30秒；真实Electron最小化另30秒；设置30秒，其他页各12秒。表中是实测次数换算成每分钟，短窗口可能某个低频定时器未到期。\n\n注意：Windows（视窗系统）调试器附着时最小化仍可能报告 visible（可见）；原生最小化事件与 hidden 分别测。最小化窗口中手机仍在前台，其数值不是手机后台数。手机桥替身没有 updates.status；改前该错误被更新提示重绘放大，属于本机桥调用，不能算成真实中继流量。\n\n`;
for(const stage of ['before','after']){
  const census=read(`${stage}-main`),table={stage,surfaces:[]};tables[stage]=table;
  md+=`## ${stage==='before'?'改之前':'改之后'}\n\n`;
  for(const surface of census.surfaces){
    const rows=new Map();
    for(const w of surface.windows)for(const g of w.groups){const caller=actor(g.caller,g.route),key=JSON.stringify([g.route,caller]);if(!rows.has(key)){const [purpose,necessity]=meaning(g.route);rows.set(key,{route:g.route,caller,purpose,necessity,perMinute:{},callStacks:[]});}const row=rows.get(key);row.perMinute[w.name]=(row.perMinute[w.name]||0)+g.perMinute;if(!row.callStacks.includes(g.caller))row.callStacks.push(g.caller);}
    const groups=[...rows.values()].sort((a,b)=>(b.perMinute['foreground-idle']||0)-(a.perMinute['foreground-idle']||0));table.surfaces.push({surface:surface.surface,windows:surface.windows.map(w=>({name:w.name,total:w.total,seconds:w.seconds,perSecond:w.perSecond})),groups});
    md+=`### ${surface.surface==='electron'?'电脑程序':'手机网页'}\n\n| 路由／桥方法 | 调用方 | 用途 | 前台空闲/分钟 | 流式/分钟 | hidden/分钟 | Electron最小化/分钟 | 设置/分钟 | 动态/分钟 | 目标/分钟 | 成果库/分钟 | 间隔是否必要／做法 |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n`;
    for(const g of groups)md+=`| ${g.route} | ${g.caller} | ${g.purpose} | ${phases.map(p=>(g.perMinute[p]||0).toFixed(1)).join(' | ')} | ${g.necessity} |\n`;
    md+=`\n总量：${surface.windows.map(w=>`${w.name} ${w.perSecond.toFixed(3)}次/秒`).join('；')}。\n\n`;
  }
  writeFileSync(`${out}/${stage}-breakdown.json`,JSON.stringify(table,null,2)+'\n');
}
const before=read('before-main'),after=read('after-main');
md+=`## 根因与调整\n\n1. 没发现重进页面遗留旧对话定时器：原轮询清理已有保护。实际重复是目标页与全局徽标同时读完整目标页，以及正文读取与全量刷新同读历史。现在徽标不读目标页、正文与概览各自负责数据。\n2. 手机每次正文读取结束都刷新审批、提问、活动命令和任务详情；空闲又每次刷新会话及状态。现在原生事实（工具、回合、审批、问题等）变化触发任务读取；正文增长只更新正文。\n3. 桌面原6秒全量刷新重读模型、偏好、用量、手机同步；手机聊天徽标读当前不显示的目标页。配置入页／回执刷新，列表独立5500毫秒，给网络留500毫秒以守住6秒同步目标。\n4. Electron最小化时只看document可见性不够。接入既有onVisibility（原生可见性）桥；目标、成果库、数据页、副本等读取也遵守前后台。手机隐藏暂停前台轮询，恢复立即补读。安卓原生通知轮询仍需新壳处理。\n5. 保留现有列表／逻辑聊天各自的必要响应和独立决策回执，未新建聚合接口。复用状态快照、原生增量、读请求去重；新增可选changes等待参数使用DSH原生事件和账户提交唤醒，消除低频轮询造成的首字延迟。\n\n合理下限：现有列表协议为跨设备列表、逻辑聊天、项目等每5500毫秒多次独立读取，另有动态徽标、连接探测与待批准设备；当前约1次/秒有依据。支持事件等待的正文空闲网页约每30秒、原生桥约每15秒一次；要继续降到接近0，需要列表／连接／待办统一推送。兼容会话无等待能力时正文1500毫秒一次，后台仍仅60秒探测；连replyStreaming也没有的旧宿主保留全量刷新，需先更新宿主才能达到本包前台目标。\n\n`;
const latency=read('responsiveness');md+=`## 逐项响应验证\n\n| 项目 | 端 | 毫秒 |\n|---|---|---:|\n`;for(const c of latency.checks)if(c.ms!==undefined)md+=`| ${c.name} | ${c.surface||'手机'} | ${c.ms} |\n`;
const timeline=read('timeline/synthetic/results');const native=timeline.wire.find(r=>r.layer==='native'&&r.type==='assistant/chunk'&&r.chunk==='text-delta');
for(const surface of ['desktop','phone']){const first=timeline[surface].frames.find(f=>f.length>0);md+=`\n${surface}首块→首字${first.at-native.at}毫秒；正文长度${new Set(timeline[surface].frames.map(f=>f.length)).size}种；结束呼吸点${timeline[surface].remainingDots}。`;}
const interactions=read('interactions/interactions');md+=`\n\n弹层与中文组合输入：${interactions.surfaces.map(s=>`${s.surface} ${s.checks.filter(c=>c.passed).length}/11`).join('，')}；每个菜单在流式中保持至少3.1秒、节点身份相同、正文继续增长；中文文字／选区／焦点保留。打开状态浅深图在interactions/，这些是网页内容与程序截图，不冒充手机原生系统栏验收。\n\n自动预算检查位于apps/mobile-ui/tests/chat-interactions.test.mjs，随必跑手机5文件组执行：实际共享界面与桥替身，合成时钟前台30秒≤66次（2/秒加10%调度余量）、后台30秒≤3次，计入每个桥方法并断言正文和元数据计时器确实执行。真实Electron／桥计数运行器另断言实际空闲≤2/秒与后台30秒≤3次；时间线的--budgets另外覆盖固定DSH实际宿主与合成模型。\n\n`;
const idle=after.surfaces.find(s=>s.surface==='mobile').windows.find(w=>w.name==='foreground-idle');
const local=new Set(['updates.status','shared.outbox.list','attachments.list','models.list','conversations.list','app.activity']);
const wire=idle.wire.filter(w=>!local.has(w.route)),bytes=wire.reduce((n,w)=>n+w.requestBodyBytes+w.responseBodyBytes,0),dailyCalls=wire.length/idle.seconds*86400;
const traffic={seconds:idle.seconds,calls:wire.length,payloadBytes:bytes,averagePayloadBytes:bytes/wire.length,estimatedDailyCalls:dailyCalls,estimatedPayloadBytesPerDay:bytes/idle.seconds*86400,estimatedWithOneKiBOverheadBytesPerDay:(bytes/idle.seconds+wire.length/idle.seconds*1024)*86400};writeFileSync(`${out}/relay-estimate.json`,JSON.stringify(traffic,null,2)+'\n');
md+=`## 中继流量与安卓／苹果后续\n\n这不是实网中继抓包。合成桥量的是UTF-8（字符编码）请求／响应正文；updates.status和shared.outbox.list等本机方法按原生代码排除。当前${idle.seconds.toFixed(3)}秒中网络方法${wire.length}次、正文${bytes}字节，平均每次约${Math.round(traffic.averagePayloadBytes)}字节；不同方法约100–1800字节。按全天同样节奏，正文约${(traffic.estimatedPayloadBytesPerDay/1e6).toFixed(1)} MB（兆字节）/天；每调用另预留1 KiB（1024字节）给HTTP头、TLS（加密连接）与中继封装，约${(traffic.estimatedWithOneKiBOverheadBytesPerDay/1e6).toFixed(1)} MB/天。Cookie（会话凭据）、会话数、重连和证书开销会改变数值；已有更新SSE16秒13字节保活约70 KB/天，安卓原生5秒通知查询尚未计入网页数字。\n\n桥调用本身是本机JSON消息，不意味着每次都穿过中继；只有Network.kt中的宿主HTTP方法才耗中继流量。长期完整推送需DSH事件进入宿主的账户／会话授权订阅，带可恢复水位，再经中继长连接转发；网页、Electron和原生壳统一订阅、去重、后台取消与恢复。中继已经转发TCP（网络传输）连接，可沿用内容加密；真正系统后台推送仍要原生通知提供方与各平台接线。本包仅给既有changes读取增加事件等待，完整推送不在本包。\n\n安卓只读：HybridActivity的通知查询前台／后台每5秒调用activity/changes（每分钟12次），onPause未取消，只在onDestroy取消；权限未注册时还可能查询status。需要新壳版本：原生按前后台分档、收到事件后查询，和页面状态共享读取。现有原生业务HTTP读超时20秒，共享层等待最多15秒；取消先释放界面等待，底层响应返回前保留另一工作线程给动作和前台补读，无新壳方法。既有WorkManager（安卓后台任务库）最短约15分钟补发保持；更新订阅是既有app/updates SSE，前台一条连接、16秒保活、失败3秒重连，后台断开；更新检查是进入前台的事件，不是高频计时器。活跃本地模型租约每10秒续约，只在生成中，前台空闲为0。未改壳代码、版本号或权限；未用MuMu。\n\nApple（苹果端）清单：\n\n- 生成正文250毫秒；replyWait精确为1时现代主对话／旁聊用changes事件等待，网页最长30秒、原生桥15秒，携带已接纳liveRevision；旧宿主空闲1500毫秒。\n- 会话列表5500毫秒，动态徽标与当前页面读取避免重复；任务／审批／问题由原生事实变化触发，处理前和回执后保持来源核对。\n- 后台停前台读取、取消未结束的事件等待；只允许低频连接探测（60秒）；恢复前台立即读取当前页、列表、正文、决策，目标1秒。\n- 配置入页／写回或低频读取；渲染不触发更新状态查询；订阅与定时器按账户／设备／会话清理。\n- 无新增路由；现有changes可选waitMs/liveRevision与replyWait能力要接线，身份变化与迟到返回继续丢弃。\n\n`;
for(const group of ['required','vendor']){if(existsSync(`${out}/${group}.json`)){const result=read(group);md+=`${group}结果见${group}.json与${group}.txt：${JSON.stringify(result).slice(-400)}\n\n`;}}
writeFileSync(`${out}/README.md`,md);console.log('BL-29 evidence tables generated');
