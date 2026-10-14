import { evidencePath } from '../helpers/evidence-path.mjs';
// Synthetic schema-8 and schema-9 clouds, real signed device/host protocols,
// production phone offline component. No real model or emulator settings.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,symlink,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {fixture} from '../../services/cloud/test/identity-helpers.mjs';
import {registration,appDevice,control,refresh,hostFixture} from '../../services/cloud/test/app-helpers.mjs';
import {taskRecipient} from '../../src/personal-offline/crypto.mjs';
import {managedMkdtemp,managedTempRoot,disposeManagedTemp} from '../helpers/managed-temp.mjs';
const root=await managedMkdtemp(join(managedTempRoot(),'wm-s7-cloudcompat-')),out=evidencePath('s7'),legacy=join(root,'legacy'),source=resolve('src/personal-access-ui');
await mkdir(legacy,{recursive:true});await mkdir(out,{recursive:true});
// Pin the schema-8 baseline so this evidence remains reproducible after main upgrades.
const ref='9a9f53f0593d4333843a296cdbe2533757b4aa57';
const files=execFileSync('git',['ls-tree','-r','--name-only',ref,'services/cloud/src','services/cloud/migrations'],{encoding:'utf8'}).trim().split('\n');
for(const file of files){const path=join(legacy,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,execFileSync('git',['show',ref+':'+file]));}
const link=join(legacy,'node_modules');await symlink(resolve('services/cloud/node_modules'),link,'junction');
const implementation={...(await import(pathToFileURL(join(legacy,'services/cloud/src/database.mjs')).href)),...(await import(pathToFileURL(join(legacy,'services/cloud/src/identity.mjs')).href))};
const results=[];let browser,server;
try{
  browser=await chromium.launch({headless:true});
  for(const old of [true,false]){
    const cleanup=[],requests=[],f=await fixture({after:fn=>cleanup.push(fn)},{...(old?{implementation}:{}),observeRequest:path=>requests.push(path)});let page;
    try{
      await registration(f);const desktop=await appDevice(f,'desktop'),phone=await appDevice(f,'phone'),h=await hostFixture(f,{after:fn=>cleanup.push(fn)}),local=await h.exchange(desktop,'/auth/cloud-desktop');
      const connected=(await control(phone,'/hosts/connect',{hostId:h.started.hostId})).data;await refresh(phone,connected.resource);const auth=await h.exchange(phone,'/auth/cloud-session');assert.equal(auth.status,200);await refresh(phone,f.config.audience);
      await h.hostApi('/offline/sync',{publicJwk:taskRecipient().publicJwk,generation:0,hashes:{}},local);await h.host.syncCloudRevocations();
      const status=(await control(phone,'/hosts/offline/status',{hostId:h.started.hostId})).data;
      assert.equal(status.capabilities?.offlineTasks===1,!old);const schema=f.db.prepare('SELECT max(version) AS n FROM schema_migrations').get().n;assert.equal(schema,old?8:9);
      assert.equal(!!f.db.prepare("SELECT name FROM sqlite_master WHERE name='offline_tasks'").get(),!old);
      let taskCalls=0,errors=[];
      const html='<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/offline.css"><script src="/popovers.js"></script><script src="/icons.js"></script><script src="/ui-core/offline.js"></script><script src="/components/offline.js"></script></head><body><header style="padding:16px">WeftMate</header><main id="chat-scroll" style="height:calc(100dvh - 60px)"></main></body></html>';
      server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8').end(html.replace('<script src="/popovers.js">','<link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/message-actions.css"><link rel="stylesheet" href="/ui-core/dialogs.css"><script src="/popovers.js">'));return;}const name=req.url.slice(1);if(!/^[a-zA-Z0-9/_-]+\.(css|js)$/.test(name))return res.writeHead(404).end();const path=name.startsWith('ui-core/')?resolve('src/ui-core',name.slice(8)):join(source,name);res.setHeader('content-type',name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8').end(await readFile(path));}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(0,'127.0.0.1',done));
      page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
      await page.exposeFunction('compatStatus',async()=> (await control(phone,'/hosts/offline/status',{hostId:h.started.hostId})).data);
      await page.exposeFunction('compatTasks',async(action,body)=>{taskCalls++;return (await control(phone,'/hosts/offline/tasks/'+action,body)).data;});
      const identity={origin:'synthetic-phone',ownerId:auth.account.ownerId,hostId:h.started.hostId,deviceId:'synthetic-phone-cookie'},recipient=taskRecipient();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      // The offline composer coexists with MOB-3's phone stylesheet. Its own
      // plus menu must retain the cloud capability gate and visible controls.
      await page.addStyleTag({url:'/phone-unify.css'});await page.evaluate(()=>document.body.classList.add('phone-unified'));
      await page.evaluate(async({identity,status,recipient})=>{const vault=await WeftOffline.browserVault(JSON.stringify([identity.origin,identity.ownerId]));await vault.save({snapshot:{generation:1,items:[],recent:[],taskRecipient:recipient,model:{modelId:'synthetic-chat'},control:status},tasks:[],turns:[],conversations:[]});vault.close();const create=WeftOffline.create;WeftOffline.create=async options=>globalThis.compatEngine=await create(options);globalThis.compatCore={state:{cloudAuth:{hosts:[]}},foreground:()=>true,connectionView:()=>({kind:'host_offline'}),cloudOfflineStatus:()=>compatStatus(),cloudOfflineTasks:(...args)=>compatTasks(...args),cloudOfflineTaskDevice:async()=> 'synthetic-phone'};globalThis.compatView=WeftOfflineView.mount({core:compatCore,identity:async()=>identity,host:async()=>{throw {code:'HOST_OFFLINE'};}});},{identity,status,recipient:recipient.publicJwk});
      await page.waitForFunction(()=>globalThis.compatEngine?.view().ready);await page.evaluate(()=>compatView.tick());await page.evaluate(()=>compatCore.openOfflineMode());
      await page.getByRole('button',{name:'更多发送方式'}).click();assert.equal(await page.getByRole('menuitemradio',{name:'交给电脑，上线后做',exact:true}).count(),old?0:1);
      const offlineInput=await page.getByRole('textbox',{name:'离线消息'}).boundingBox();assert.ok(offlineInput.width>0&&offlineInput.y+offlineInput.height<=844,'offline composer remains visible with the phone presentation');
      assert.equal((await page.evaluate(()=>compatCore.offlineTasksView())).length,0);assert.equal(await page.locator('[role=status]').filter({hasText:/失败|错误|失效/}).count(),0);
      const file=old?'mobile-cloud8-plus.png':'mobile-cloud9-plus.png';await page.screenshot({path:join(out,file)});await new Promise(done=>setTimeout(done,5500));
      const taskRoutes=requests.filter(path=>path.includes('/hosts/offline/tasks/')).length;assert.ok(requests.some(path=>path.includes('/hosts/revocations')));if(old){assert.equal(taskCalls,0);assert.equal(taskRoutes,0);}assert.deepEqual(errors,[]);
      results.push({schema,capability:status.capabilities??null,phoneTaskRequests:taskCalls,loggedTaskRoutes:taskRoutes,menuTaskEntry:!old,pageErrors:errors,file});
    }finally{await page?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));server=null;}for(const fn of cleanup.reverse())await fn();}
  }
  await writeFile(join(out,'cloud-compat.json'),JSON.stringify({legacyRef:ref,realSyntheticClouds:true,realPhoneComponent:true,modelRequests:0,results},null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser?.close();await unlink(link);await disposeManagedTemp(root);}
