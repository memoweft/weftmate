import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,realpath,mkdir,writeFile,readFile,symlink,unlink,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {fixture} from '../services/cloud/test/identity-helpers.mjs';
import {registration,appDevice,control,refresh,hostFixture} from '../services/cloud/test/app-helpers.mjs';

test('schema-9 cloud with two computers: new client keeps the old response and issues zero new route requests',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'weftmate-m3-old-cloud-'))),baseline='58589464';
  const paths=execFileSync('git',['ls-tree','-r','--name-only',baseline,'services/cloud/src','services/cloud/migrations'],{encoding:'utf8'}).trim().split('\n');
  for(const path of paths){const file=join(root,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,execFileSync('git',['show',baseline+':'+path]));}
  const link=join(root,'node_modules');await symlink(resolve('services/cloud/node_modules'),link,'junction');
  const cleanup=[];t.after(async()=>{for(const close of cleanup.reverse())await close();await unlink(link);await rm(root,{recursive:true,force:true});});
  const implementation={...await import(pathToFileURL(join(root,'services/cloud/src/database.mjs')).href),...await import(pathToFileURL(join(root,'services/cloud/src/identity.mjs')).href)};
  const requests:string[]=[];
  const f=await fixture({after:fn=>cleanup.push(fn)},{implementation,observeRequest:path=>requests.push(path)});
  await registration(f);const a=await appDevice(f,'desktop'),b=await appDevice(f,'laptop'),phone=await appDevice(f,'phone');
  const desk=await hostFixture(f,{after:fn=>cleanup.push(fn)}),laptop=await hostFixture(f,{after:fn=>cleanup.push(fn)});
  await desk.exchange(a,'/auth/cloud-desktop');await laptop.exchange(b,'/auth/cloud-desktop');
  await desk.host.syncCloudRevocations();await laptop.host.syncCloudRevocations();
  const directory=(await control(phone,'/devices')).data;assert.equal(directory.hosts.length,2);assert.equal(directory.capabilities,undefined);
  await control(phone,'/hosts/connect',{hostId:desk.started.hostId});await refresh(phone,f.config.audience+'/hosts/'+desk.started.hostId);
  const auth=await desk.exchange(phone,'/auth/cloud-session');assert.equal(auth.status,200);
  const ctx:any=vm.createContext({Date,Map,Set,Promise,URL,JSON});ctx.globalThis=ctx;ctx.WeftUiCore={factories:{}};
  vm.runInContext(await readFile('src/ui-core/computers.js','utf8'),ctx);
  const legacy=await desk.hostApi('/sessions?archived=all',undefined,auth),count=requests.length;
  const core:any={state:{cloudAuth:{sub:auth.account.ownerId},sessions:[],hostId:desk.started.hostId},accessBase:'/personal/v1',authBase:'/personal/v1/auth',
    accessApi:async path=>(await desk.hostApi(path,undefined,auth)).data,requestJson:async()=>({}),selectSession:async()=>{},startNewConversation:()=>{},clearSession:()=>{},
    memoryRequest:async()=>({}),refreshSessions:async()=>{},cloudCurrentComputer:()=>desk.started.hostId};
  const effects={openComputerChannel:async()=>{throw Error('old cloud must not open a new channel');}};
  ctx.WeftUiCore.factories.computers(core,effects,{storage:{getItem:()=>null,setItem:()=>{}}});core.updateComputerDirectory(directory);
  assert.equal(core.hasMultipleComputers(),false);const listed=await core.accessApi('/sessions?archived=all');
  assert.deepEqual({...listed,snapshotAt:null},{...legacy.data,snapshotAt:null});
  assert.ok(Number.isFinite(Date.parse(listed.snapshotAt)));
  await core.startNewConversation();assert.equal(requests.length,count);
  assert.ok(!requests.some(path=>/\/hosts\/(rename|remove)$|\/auth\/cloud-channel$/.test(path)));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,9);
});
