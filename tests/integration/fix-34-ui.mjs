/* Production Electron shell and remote webpage, isolated synthetic account only. */
import assert from 'node:assert/strict';
import { chromium, _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { health6Synthetic } from '../helpers/health-6-synthetic.mjs';
const out=resolve('tests/evidence/fix-34');await mkdir(out,{recursive:true});
const f=await startTimelineCandidate({daily:true,sidebar:true,interactive:true,composer:true});
const profile=await mkdtemp(join(tmpdir(),'weftmate-fix34-electron-'));
const report={synthetic:true,modelRequests:0,realDesktopShell:true,browserSystemBars:false,phoneViewport:'390×844 remote webpage; browser chrome not captured',screenshots:[],errors:[]};
let app,browser;
async function shot(page,name){await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished)));await page.screenshot({path:join(out,name+'.png')});report.screenshots.push(name+'.png');}
async function setup(page){
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile('src/personal-access-ui/app.js','utf8')).replace('ui.loadAttachmentHasher =','globalThis.__fixCore=core;globalThis.__fixUi=ui;ui.loadAttachmentHasher =')}));
  await localUiSession(page,f.credentials,'合成验收设备',{nativeIdentity:{origin:f.origin,libraryDesktopToken:f.libraryDesktopToken}});
  await page.waitForFunction(()=>globalThis.__fixCore?.state.ownerId);
  await page.evaluate(async id=>{await __fixCore.selectSession(id);await __fixCore.refreshModels();},f.sessionId);
}
async function scenes(page,prefix){
  await page.evaluate(()=>{
    const core=__fixCore,ui=__fixUi;core.stopConnection();core.refreshConversationApprovals=async()=>true;core.refreshConversationTasks=async()=>true;
    core.state.currentView='assistant';core.show('assistant');
    const entry=[...core.conversationApprovals.entries.values()].find(e=>e.row.status==='pending');
    if(entry){entry.authoritative=true;entry.notice='';entry.row.toolName='mcp__c_synthetic__read';entry.row.reason='读取文件。操作：read\n{"path":"/synthetic/report.md"}';entry.row.secondOpinion={alignment:'拿不准',externalInfluence:'没有',reason:'这次没来得及复核，由你决定'};}
    core.readApprovalPresentation=async row=>core.approvalPresentation(row);ui.renderConversationApprovals();
    const transcript=document.getElementById('transcript');
    const list=document.createElement('ol');list.className='chat-progress';transcript.append(list);
    WeftTimeline.render([{seq:1,type:'turn.started',sessionId:'synthetic',data:{turn:1}},{seq:2,type:'step.completed',sessionId:'synthetic',data:{stepId:'health',taskId:'synthetic:turn-1',toolName:'health_query',state:'completed'}},{seq:3,type:'step.completed',sessionId:'synthetic',data:{stepId:'mail',taskId:'synthetic:turn-1',toolName:'mcp__c_synthetic__mail_read',state:'completed'}},{seq:4,type:'turn.ended',sessionId:'synthetic',data:{turn:1,reason:'completed'}}],list);
  });
  await page.getByText('这次没来得及复核，由你决定',{exact:true}).first().waitFor();
  assert.match(await page.locator('#approval-bar').innerText(),/读取 1 个文件：report.md/);
  await shot(page,prefix+'-approval');
  await page.locator('#approval-bar details').first().evaluate(n=>n.open=true);
  assert.match(await page.locator('#approval-bar pre').first().innerText(),/mcp__c_synthetic__read/);
  await shot(page,prefix+'-approval-details');
  await page.evaluate(()=>{
    const core=__fixCore,ui=__fixUi;core.state.cloudAuth.mode='authenticated';
    core.cloudDirectory=async()=>({devices:[{id:'synthetic-phone',name:'合成手机',type:'web',isCurrent:true}],hosts:[]});
    ui.openSettings('devices');ui.selectCloudSettings('devices');ui.paintCloudSettings();
  });
  await page.getByText('这个账号还没有连上电脑。在电脑上用同一个账号登录后，这里会出现。',{exact:true}).waitFor();
  await shot(page,prefix+'-no-computer');
  const health=health6Synthetic();
  await page.route('**/personal/v1/health/**',async route=>{const url=new URL(route.request().url());const data=health.reply(url.pathname+url.search);if(url.pathname.endsWith('/overview')){data.insight.text='昨晚睡了 7 小时 46 分，今天按自己的节奏安排。';data.insight.observations=[{text:'昨晚睡了 7 小时 46 分，目标 7 小时 30 分。',inputs:['sleepMinutes']}];}await route.fulfill({json:data});});
  await page.route('**/personal/v1/settings/health',route=>route.fulfill({json:health.reply('/settings/health')}));
  await page.evaluate(()=>{__fixCore.state.cloudAuth.mode='offline';__fixUi.openHealth();});
  await page.getByText('昨晚睡了 7 小时 46 分，今天按自己的节奏安排。',{exact:true}).waitFor();
  await shot(page,prefix+'-health');
  await page.evaluate(()=>{
    __fixUi.openSettings('memory');const target=document.querySelector('.settings-category[data-category="memory"]');
    const jobs=[{jobId:'synthetic-import',app:'chatgpt',appName:'ChatGPT',createdAt:'2026-10-12T12:00:00Z',state:'completed',processed:2,total:2,memoryCount:3,usage:{requests:2,inputTokens:1200,outputTokens:200,cost:.000004,unknownRequests:0}}];
    WeftHistoryImportView({target,owner:()=> 'synthetic-account',request:async()=>({ownerId:'synthetic-account',imports:jobs})});
  });
  await page.getByText('2 次请求 · 约 1.4 千字 · 不到 1 分钱',{exact:true}).first().waitFor();
  await shot(page,prefix+'-import');
  await page.evaluate(()=>{
    const core=__fixCore,ui=__fixUi;ui.openSettings('models');
    ui.paintSystem({components:[],backgroundModelFallback:{profileId:'removed'},queue:{},metrics:{}},{backgroundModelProfileId:null,currentChatModelProfileId:'local'},{models:core.state.models,canManage:true},core.accountToken());
  });
  await page.locator('#background-model-notice').filter({hasText:'后台模型不可用，暂时用聊天模型代替'}).waitFor();
  await shot(page,prefix+'-background-model');
  await page.evaluate(()=>{
    __fixCore.show('login');Object.assign(__fixCore.state.cloudAuth,{mode:'recovery',step:'code',email:'synthetic@example.invalid',resendAt:0,modal:false});
    __fixUi.paintCloudAuth(__fixCore.cloudAuthView());
  });
  await page.getByText('如果这个邮箱注册过，几分钟内会收到验证码；没收到请检查邮箱是否填对，或直接注册。',{exact:true}).waitFor();
  await shot(page,prefix+'-recovery');
}
try{
  const env={...process.env,WEFTMATE_TEST_HOST_NAME:'synthetic-host'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_LIBRARY_TOKEN:f.libraryDesktopToken,REVIEW_THEME:'light'}});
  const desktop=await app.firstWindow();await setup(desktop);
  for(const width of [1200,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,844),width);if(width===480)await setup(desktop);await scenes(desktop,`electron-${width}-light`);}
  browser=await chromium.launch({headless:true});const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await phone.goto(f.origin+'/personal/v1/ui/');await setup(phone);await scenes(phone,'phone-web-390-light');
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({screenshots:report.screenshots.length,errors:report.errors}));
}finally{await app?.close();await browser?.close();await f.close();await rm(profile,{recursive:true,force:true});await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');}
