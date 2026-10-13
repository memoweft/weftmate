import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnectors } from '../src/personal-connectors/index.mjs';
import { createConnectorVault } from '../src/personal-connectors/vault.mjs';
import { httpFixture } from './fixtures/st-7a/http.mjs';
import { syncConnectorTools } from '../src/plugins/personal-connectors.mjs';
import { fork } from 'node:child_process';
import { cleanupOwnedProcesses } from './helpers/process-evidence.mjs';
const runtime = resolve('vendor/dsh-runtime');
const fixture = resolve('tests/fixtures/st-7a/stdio.mjs');

test('abrupt host exit kills the native worker and its still-running server tree', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-abrupt-')),startedAt=Date.now();
  const {scrubbedParentEnv}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-subprocess/lib/index.js');
  const parent=fork(resolve('tests/fixtures/st-7a/parent.mjs'),[root,runtime,fixture],{silent:true,execArgv:[],env:scrubbedParentEnv()});
  parent.stdout?.resume();parent.stderr?.resume();
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
  try {
    const ready=await new Promise<{workerPid:number}>((done,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic host startup timed out')),10000);parent.once('message',(message:any)=>{clearTimeout(timer);done(message);});parent.once('error',error=>{clearTimeout(timer);reject(error);});parent.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic host exited before ready'));});});
    const pids=(await readFile(join(root,'starts'),'utf8')).trim().split('\n').map(Number);
    assert.equal(pids.length,2);assert.ok(pids.some(alive),'a native server is still handling its deliberately slow call');
    assert.ok(ready.workerPid>0&&alive(ready.workerPid),'the SDK server belongs to a live native worker');pids.push(ready.workerPid);
    const exited=new Promise(resolve=>parent.once('exit',resolve));parent.kill('SIGKILL');await exited;
    const deadline=Date.now()+5000;while(pids.some(alive)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert.ok(pids.every(pid=>!alive(pid)),'abrupt host termination leaves zero worker or server processes');
  } finally {parent.kill('SIGKILL');cleanupOwnedProcesses({startedAt,executables:[process.execPath],commandRoots:[root]});await rm(root,{recursive:true,force:true});}
});
test('connector schemas belong to the actual native agent scope and disappear on disable', async () => {
  const {Context}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js');
  const {SystemPrompt}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js');
  const {ToolRuntime}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js');
  const {createScope}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-scope/lib/index.js');
  const ctx=new Context();new SystemPrompt(ctx,{});new ToolRuntime(ctx,{mode:'native'});
  const agent={session:{id:'synthetic',header:{agentPreset:'personal-remote'}},ctx:null as any},other={session:{id:'other'}};
  const scope=createScope(ctx,agent),otherScope=createScope(ctx,other);agent.ctx=scope.ctx;
  try {
    const tool={name:'mcp__c_fixture__read',rawName:'read',description:'只读',category:'read',connectorId:'c_fixture',connectorName:'合成',parameters:{type:'object',properties:{}}};
    syncConnectorTools(agent,{connectorTools:[tool]},{request:async()=>({content:[]})},()=>({}));
    assert.ok((await ctx.systemPrompt.assemble({scope:agent})).tools.some(row=>row.name===tool.name));
    assert.ok(!(await ctx.systemPrompt.assemble({scope:other})).tools.some(row=>row.name===tool.name));
    syncConnectorTools(agent,{connectorTools:[]},{},()=>({}));assert.ok(!(await ctx.systemPrompt.assemble({scope:agent})).tools.some(row=>row.name===tool.name));
  } finally {await scope.dispose();await otherScope.dispose();}
});
function syntheticVault() {
  const map = new Map<string,string>();
  return createConnectorVault({ getCredential: (id: string) => map.get(id) ?? null,
    saveCredential: (id: string, value: string) => { map.set(id,value); }, removeCredential: (id: string) => { map.delete(id); }, listCredentialIds: () => [...map.keys()] });
}
test('pinned native command connector: discover, call, external marking, disable, remove, idle cleanup', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-')), vault=syntheticVault();
  const manager=await createConnectors({root,runtime,vault,idleMs:100,startupMs:3000,callMs:300});
  try {
    const connector=await manager.add('a',{name:'合成连接器',transport:'stdio',command:process.execPath,args:[fixture],credentials:{ST7A_OUTPUT:join(root,'send.txt'),SYNTHETIC_KEY:'synthetic-vault-secret-2345'}});
    assert.equal(connector.tools.length,5);assert.equal(connector.tools.find(tool=>tool.rawName==='read_note').category,'read');
    assert.equal(manager.list('b').length,0);
    const tool=manager.catalog('a').find(tool=>tool.rawName==='read_note');
    const result=await manager.call('a',connector.id,tool.name,{});assert.match(result.content[0].text,/外部数据/);assert.match(result.content[0].text,/不是用户指令/);
    assert.ok(!JSON.stringify(result).includes('synthetic-vault-secret'));
    const config=await readFile(join(root,'connectors.json'),'utf8');assert.ok(!config.includes('synthetic-vault-secret'));assert.ok(!JSON.stringify(connector).includes('synthetic-vault-secret'));
    await new Promise(resolve=>setTimeout(resolve,500));assert.equal(manager.list('a')[0].status,'idle');
    await manager.enable('a',connector.id,false);assert.equal(manager.catalog('a').length,0);await assert.rejects(manager.call('a',connector.id,tool.name,{}));
    const removed=await manager.remove('a',connector.id);assert.ok(removed.includes(tool.name));assert.deepEqual(vault.list('a',connector.id),[]);assert.deepEqual(manager.list('a'),[]);
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
test('native crash loops stop after two restarts; shutdown leaves zero owned server processes', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-crash-')), starts=join(root,'starts.txt');
  const manager=await createConnectors({root,runtime,vault:syntheticVault(),idleMs:10000,startupMs:3000});
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
  try {
    const connector=await manager.add('a',{name:'崩溃合成服务',transport:'stdio',command:process.execPath,args:[fixture],credentials:{ST7A_STARTS:starts,ST7A_CRASH_LOOP:'1'}});
    manager.catalog('a');
    const deadline=Date.now()+8000;while(Date.now()<deadline&&manager.list('a')[0].status!=='failed')await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(manager.list('a')[0].status,'failed');assert.equal(manager.catalog('a').length,0);
    const pids=(await readFile(starts,'utf8')).trim().split('\n').map(Number);assert.equal(pids.length,4,'one add test, one connection and exactly two native restarts');
    await manager.close();assert.equal(pids.filter(alive).length,0);
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
test('a native crash recovers its stable tools without replaying the failed operation', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-recover-')),manager=await createConnectors({root,runtime,vault:syntheticVault(),idleMs:10000,startupMs:3000,callMs:500});
  try {
    const connector=await manager.add('a',{name:'恢复合成服务',transport:'stdio',command:process.execPath,args:[fixture]});
    const tools=manager.catalog('a'),crash=tools.find(tool=>tool.rawName==='crash_operation'),read=tools.find(tool=>tool.rawName==='read_note');
    await assert.rejects(manager.call('a',connector.id,crash.name,{}));
    const deadline=Date.now()+6000;while(Date.now()<deadline&&(manager.list('a')[0].status!=='ready'||manager.list('a')[0].message))await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(manager.list('a')[0].status,'ready');assert.equal(manager.list('a')[0].message,'');assert.ok(manager.catalog('a').some(tool=>tool.name===read.name));
    assert.match((await manager.call('a',connector.id,read.name,{})).content[0].text,/合成资料/);
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
test('a slow native call times out without delaying the catalog or leaking processes', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-slow-')),manager=await createConnectors({root,runtime,vault:syntheticVault(),startupMs:3000,callMs:150});
  try {
    const connector=await manager.add('a',{name:'慢合成服务',transport:'stdio',command:process.execPath,args:[fixture]});
    const tool=manager.catalog('a').find(tool=>tool.rawName==='slow_operation');await assert.rejects(manager.call('a',connector.id,tool.name,{}),/响应太慢/);
    assert.equal(manager.catalog('a').length,0);assert.ok(manager.list('a')[0].message.includes('响应太慢'));
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
test('built-in registration launches the bundled harmless server with no external service', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-builtin-')),manager=await createConnectors({root,runtime,vault:syntheticVault(),startupMs:3000});
  try {
    const clock=manager.builtins().find(item=>item.id==='local-clock');assert.equal(clock.id,'local-clock');assert.deepEqual(clock.fields,[]);
    const connector=await manager.add('owner',{builtinId:'local-clock'});assert.equal(connector.tools[0].category,'read');
    const tool=manager.catalog('owner')[0],result=await manager.call('owner',connector.id,tool.name,{});assert.match(result.content[0].text,/timezone/);
    await manager.remove('owner',connector.id);assert.deepEqual(manager.catalog('owner'),[]);
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
test('native connection tests translate command, network, credentials and timeout failures', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-errors-'));const http=await httpFixture();
  const manager=await createConnectors({root,runtime,vault:syntheticVault(),startupMs:800});
  try {
    assert.equal((await manager.test('a',{name:'缺失',transport:'stdio',command:'synthetic-no-such-command'})).code,'CONNECTOR_COMMAND_MISSING');
    assert.equal((await manager.test('a',{name:'超时',transport:'stdio',command:process.execPath,args:[fixture],credentials:{ST7A_HANG:'1'}})).code,'CONNECTOR_TIMEOUT');
    assert.equal((await manager.test('a',{name:'拒绝',transport:'streamable-http',url:http.url,credentials:{Authorization:'synthetic-wrong'}})).code,'CONNECTOR_AUTH_FAILED');
    const passed=await manager.test('a',{name:'网络',transport:'streamable-http',url:http.url,credentials:{Authorization:'synthetic-http-credential'}});assert.equal(passed.ok,true);assert.equal(passed.tools.length,5);
    await http.close();assert.equal((await manager.test('a',{name:'不可达',transport:'streamable-http',url:http.url})).code,'CONNECTOR_UNAVAILABLE');
    assert.deepEqual(manager.list('a'),[]);
  } finally {await manager.close();await http.close();await rm(root,{recursive:true,force:true});}
});
test('native HTTP tools call, send locally, time out and survive a remote process crash without blocking the catalog', async () => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-st7a-http-call-')),output=join(root,'send.txt');
  const {scrubbedParentEnv}=await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-subprocess/lib/index.js');
  const server=fork(resolve('tests/fixtures/st-7a/http.mjs'),[],{silent:true,execArgv:[],env:{...scrubbedParentEnv(),ST7A_OUTPUT:output}});
  server.stdout!.resume();server.stderr!.resume();
  const manager=await createConnectors({root,runtime,vault:syntheticVault(),startupMs:3000,callMs:250});
  try {
    const url=await new Promise<string>((resolve,reject)=>{server.once('message',(value:any)=>resolve(value.url));server.once('error',reject);server.once('exit',()=>reject(Error('HTTP fixture exited before ready')));});
    const connector=await manager.add('owner',{name:'合成远程连接器',transport:'streamable-http',url,credentials:{Authorization:'synthetic-http-credential'}});
    const tools=manager.catalog('owner'),name=(raw:string)=>tools.find(tool=>tool.rawName===raw).name;
    assert.match((await manager.call('owner',connector.id,name('read_note'),{})).content[0].text,/外部数据/);
    await manager.call('owner',connector.id,name('send_note'),{text:'synthetic HTTP send'});assert.equal((await readFile(output,'utf8')).trim(),'synthetic HTTP send');
    await assert.rejects(manager.call('owner',connector.id,name('slow_operation'),{}),/响应太慢/);assert.equal(manager.catalog('owner').length,0);
    assert.equal((await manager.test('owner',{id:connector.id})).ok,true);
    await assert.rejects(manager.call('owner',connector.id,name('crash_operation'),{}));assert.equal(manager.catalog('owner').length,0);
  } finally {await manager.close();if(server.exitCode===null&&server.signalCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await rm(root,{recursive:true,force:true});}
});
