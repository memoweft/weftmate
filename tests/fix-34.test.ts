import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { statisticalHealthInsight } from '../src/personal-health/insight.mjs';
import { healthScores } from '../src/personal-health/analysis.mjs';
import { HEALTH_DEFAULTS } from '../src/personal-health/records-schema.mjs';
import { generateHealthSequence } from './helpers/health-sequence.mjs';
import { weeklyDayPhrase } from '../src/personal-access/daily-digest.mjs';
import { observedHealthEvidence } from '../src/personal-health/summary.mjs';

function ui() {
  const context:any = { WeftUiCore:{factories:{}}, Intl, Date, URL, setTimeout, clearTimeout, setInterval, clearInterval };
  for (const file of ['human-format','timeline-model','approvals','usage','cloud-account']) runInNewContext(readFileSync(`src/ui-core/${file}.js`,'utf8'),context);
  const core:any = {...context.WeftUiCore,state:{},accountToken:()=>({})};
  Object.assign(core,context.WeftUiCore.factories.approvals(core,{},{}),context.WeftUiCore.factories.usage(core,{}));
  return {core,context};
}
test('FIX-34 recovery help explains conditional delivery without revealing registration',()=>{
  const {core,context}=ui();const auth=context.WeftUiCore.factories.cloudAccount(core,{},{});
  const help=auth.cloudAuthView().recoveryHelp;
  assert.match(help,/如果这个邮箱注册过/);assert.match(help,/检查邮箱是否填对/);
  for(const file of ['src/personal-access-ui/components/auth.js','apps/mobile-ui/www/components/cloud-auth.js']) assert.match(readFileSync(file,'utf8'),/value\.recoveryHelp/);
});
test('FIX-34 real namespaced read-only connectors have human progress and objects',()=>{
  const {core}=ui();
  for(const [name,label] of [['health_query','查了健康数据'],['mcp__c_0123__calendar_list_events','查了日历'],['mcp__c_0123__mail_read','读了邮件'],['mcp__c_0123__mail_list','读了邮件'],['unknown_extension','用了一个扩展工具']]) assert.equal(core.progressText([{toolName:name,state:'completed'}],{terminal:true,reason:'completed'}).text,label);
  const row={toolName:'mcp__c_0123__read',reason:'读取文件。操作：read\n{"path":"/synthetic/report.md"}'};
  const value=core.approvalPresentation(row);
  assert.equal(value.summary,'读取 1 个文件：report.md');assert.equal(value.reason,'');assert.match(value.raw,/mcp__c_0123__read/);assert.match(value.raw,/synthetic/);
});
test('FIX-34 an unreviewed timeout has an explicit human note',()=>{
  const {core}=ui();const review=core.approvalReview({secondOpinion:{alignment:'拿不准',externalInfluence:'没有',reason:'这次没来得及复核，由你决定'}});
  assert.equal(review.text,'这次没来得及复核，由你决定');assert.equal(review.warning,false);
});
test('FIX-34 money has two decimals and a truthful sub-cent label',()=>{
  const {core}=ui();assert.equal(core.usageMoney(0),'¥0.00');assert.equal(core.usageMoney(.000001),'不到 1 分钱');assert.equal(core.usageMoney(.01),'¥0.01');assert.equal(core.usageMoney(1.2345),'¥1.23');
});
test('FIX-34 sleep templates and recovery reasons share hours and minutes',async()=>{
  const {formatDuration}=await import('../src/human-format.mjs');
  for(const [value,text] of [[466,'7 小时 46 分'],[0,'0 分'],[60,'1 小时'],[59.6,'1 小时'],[null,'—'],[-1,'—']]) assert.equal(formatDuration(value),text);
  const day='2026-10-12',sequence=generateHealthSequence({to:day});const state:any={settings:HEALTH_DEFAULTS,days:Object.fromEntries(sequence.items.map(row=>[row.day,{health:row.health}]))};state.days[day].health.sleepMinutes=466;
  assert.match(statisticalHealthInsight(state,{},day,'Asia/Shanghai',Date.parse(day+'T12:00:00Z')).observations[0].text,/昨晚睡了 7 小时 46 分/);
  assert.match(healthScores(state,day,'Asia/Shanghai').recovery.reasons.find(row=>row.inputs.includes('sleepMinutes')).text,/7 小时 46 分/);
});
test('FIX-34 health guidance distinguishes latest from average and formats duration',()=>{
  const source=readFileSync('src/plugins/personal-prompt.mjs','utf8');assert.match(source,/latest.*最近一次/);assert.match(source,/average.*平均/);assert.match(source,/score.*最近一次/);assert.match(source,/小时.*分/);
});
test('FIX-34 authenticated device directories explain the absence of computers and clear it when one appears',()=>{
  for(const file of ['src/personal-access-ui/components/cloud-settings.js','apps/mobile-ui/www/components/cloud-settings.js']) {
    const nodes=new Map();
    const node=(tag='',className='',textContent='')=>({tag,className,textContent,children:[],hidden:false,setAttribute(){},addEventListener(){},append(...rows){this.children.push(...rows)},replaceChildren(...rows){this.children=rows}});
    const byId=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
    const core={state:{identityGeneration:0,cloudAuth:{mode:'authenticated'}},cloudDeviceTime:()=> '今天'};
    const context:any={WeftUiComponents:{factories:{}},WeftMobileComponents:{factories:{}},WeftIcons:{create:()=>node()}};
    const source=readFileSync(file,'utf8').replace(/return \{ (mountCloudSettings|mount: mountCloudSettings)/,'return { testDirectory: renderDirectory, $1');
    runInNewContext(source,context);
    const factories=context.WeftUiComponents.factories.cloudSettings || context.WeftMobileCloudSettings;
    const view=factories(core,{byId,element:node});
    view.testDirectory({devices:[],hosts:[]});assert.equal(byId('cloud-directory-status').textContent,'这个账号还没有连上电脑。在电脑上用同一个账号登录后，这里会出现。');
    view.testDirectory({devices:[],hosts:[{hostId:'synthetic',name:'合成电脑'}]});assert.equal(byId('cloud-directory-status').textContent,'');
  }
});
test('FIX-34 unconfirmed delivery explains the next action without host terminology',async()=>{
  const {core,context}=ui();runInNewContext(readFileSync('src/ui-core/resources.js','utf8'),context);
  let notice='';core.accessApi=async()=>{throw {code:'NOT_FOUND'}};core.readMarkers=()=>[{requestId:'synthetic'}];core.operation=text=>{notice=text};
  const resources=context.WeftUiCore.factories.resources(core,{},{});
  await resources.lookupRequest({requestId:'synthetic'});
  assert.equal(notice,'暂时无法确认这条消息是否送达，不会自动重复发送。请检查连接，核对原消息后重试。');assert.doesNotMatch(notice,/宿主|回执|幂等/);
});
test('FIX-34 already repaired full-week and terminal queue projections remain correct',()=>{
  assert.equal(weeklyDayPhrase(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']),'这周每天');
  const {core}=ui();const events=[{seq:1,type:'task.queued',sessionId:'s',data:{receiptId:'r',taskId:'r'}},{seq:2,type:'user.message',sessionId:'s',data:{receiptId:'r'}},{seq:3,type:'turn.ended',sessionId:'s',data:{reason:'completed'}}];
  assert.equal(core.projectTimeline(events).cards.some(row=>row.type==='task.queued'),false);
});
test('FIX-34 persisted health evidence preserves zero duration parts for byte validation',()=>{
  const summary={schemaVersion:1,date:'2026-10-12',timeZone:'UTC',sourceDeviceId:'synthetic',sourceDevices:['synthetic'],summarizedAt:'2026-10-12T12:00:00Z',cloudModelAllowed:true,
    readStates:{sleep:'dataAvailable'},metrics:{sleep:{value:60,unit:'min',baselineDays:0}},sleep:{totalMinutes:60}};
  assert.equal(observedHealthEvidence('synthetic',summary).content,'2026-10-12 睡眠 1 小时 0 分。');
});
