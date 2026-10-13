import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnectors } from '../src/personal-connectors/index.mjs';
import { createConnectorVault } from '../src/personal-connectors/vault.mjs';
import { classifyConnectorTool, connectorPermission, connectorError } from '../src/personal-connectors/policy.mjs';
import { validPermissionRules } from '../src/plugins/personal-permission-rules.mjs';
import { httpFixture } from './fixtures/st-7a/http.mjs';
import { createEncryptedCredentialVaultStore } from '../src/credential-vault-document.ts';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { included } from '../src/personal-backup/archive.mjs';
import { connectorSettings, connectorExecution } from '../src/personal-connectors/access.mjs';
import { reviewSourceLocations } from '../src/plugins/personal-review-sources.mjs';
import { DshWebRuntime } from '../src/dsh-web-runtime.ts';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
const runtime = resolve('vendor/dsh-runtime');
const fixture = resolve('tests/fixtures/st-7a/stdio.mjs');
function syntheticVault() {
  const map = new Map<string,string>();
  return createConnectorVault({ getCredential: (id: string) => map.get(id) ?? null,
    saveCredential: (id: string, value: string) => { map.set(id,value); }, removeCredential: (id: string) => { map.delete(id); }, listCredentialIds: () => [...map.keys()] });
}
test('connector classification and individual rules conservatively reuse ST-2', () => {
  assert.equal(connectorError(new Error('fetch failed at http://127.0.0.1:54013/mcp')).code,'CONNECTOR_UNAVAILABLE');
  assert.equal(connectorError(new Error('fetch failed at http://127.0.0.1:54037/mcp')).code,'CONNECTOR_UNAVAILABLE');
  assert.equal(connectorError(new Error('HTTP 401')).code,'CONNECTOR_AUTH_FAILED');
  assert.equal(connectorError(new Error('HTTP 403')).code,'CONNECTOR_AUTH_FAILED');
  for (const [tool, expected] of [[{name:'list',annotations:{readOnlyHint:true}},'read'],[{name:'send_email',annotations:{readOnlyHint:true}},'external'],
    [{name:'purchase'},'spend'],[{name:'remove_item'},'delete'],[{name:'set_event'},'write'],[{name:'opaque'},'write']] as const) assert.equal(classifyConnectorTool(tool),expected);
  const tool={name:'mcp__fixture__send',category:'external'};
  for(const mode of ['auto','allow-all','accept-edits']) assert.equal(connectorPermission({mode,permissionRules:{external:'allow'},allowedCategories:['external']},tool).decision,'ask');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{[tool.name]:'allow'}},tool).decision,'allow');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{[tool.name]:'deny'}},tool).decision,'deny');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{},projectPermissionRules:{external:'deny'}},tool).decision,'deny');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{network:'deny',[tool.name]:'allow'}},{...tool,network:true}).decision,'deny');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{network:'ask'}},{name:'mcp__fixture__read',category:'read',network:true}).decision,'ask');
  assert.equal(connectorPermission({mode:'auto',permissionRules:{[tool.name]:'allow'},projectPermissionRules:{external:'ask'}},tool).decision,'ask');
  assert.equal(validPermissionRules({[tool.name]:'allow'}),true);
  assert.equal(validPermissionRules({external:'allow'}),false);
});
test('vault slots support rotation and account isolation without returning values', () => {
  const vault=syntheticVault();vault.save('a','c','refresh_token','synthetic-first-secret');
  assert.equal(vault.get('b','c','refresh_token'),null);assert.deepEqual(vault.list('a','c'),[{name:'refresh_token',saved:true,last4:'cret'}]);
  vault.rotate('a','c','refresh_token','synthetic-second-key');assert.equal(vault.get('a','c','refresh_token'),'synthetic-second-key');
  vault.save('a','c','short_code','1234');assert.equal(vault.list('a','c').find(row=>row.name==='short_code').last4,'');
  vault.removeConnector('a','c');assert.deepEqual(vault.list('a','c'),[]);
});
test('connector and model secrets share opaque encrypted bytes; local backup excludes the vault', () => {
  const key=randomBytes(32);let bytes:Buffer|null=null;
  const store=createEncryptedCredentialVaultStore({exists:()=>bytes!==null,readBytes:()=>bytes!,writeBytes:value=>{bytes=value;},
    encrypt:text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},
    decrypt:value=>{const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(-16));return Buffer.concat([decipher.update(value.subarray(12,-16)),decipher.final()]).toString();},validateLegacyPayload:()=>true});
  const storage={saveCredential:store.save,getCredential:(id:string)=>store.read().credentials[id]??null,removeCredential:store.remove,listCredentialIds:()=>Object.keys(store.read().credentials)};
  const vault=createConnectorVault(storage);store.save('synthetic-model','synthetic-model-private-marker');vault.save('owner','connector','refresh_token','synthetic-thirdparty-private-marker');
  assert.ok(!bytes!.includes(Buffer.from('synthetic-thirdparty-private-marker')));assert.ok(!bytes!.includes(Buffer.from('synthetic-model-private-marker')));
  assert.equal(vault.get('owner','connector','refresh_token'),'synthetic-thirdparty-private-marker');assert.equal(included('weftmate-model.enc'),false);assert.equal(included('personal-access/connectors.json'),true);
  vault.removeConnector('owner','connector');assert.equal(store.read().credentials['synthetic-model'],'synthetic-model-private-marker');
});
test('phone connector settings forbid add, secrets, removal and per-tool execution without a native receipt', async () => {
  let called=false;
  const context={connectors:{list:()=>[],builtins:()=>[],add:()=>{called=true;}},authenticate:()=>{},sessionOperations:{executionOwnerForSession:()=> 'owner'},accountState:()=>({}),personalExecutionSource:()=>({source:{toolExecutions:[]}})};
  for(const action of ['add','remove','test','rotate'])await assert.rejects(connectorSettings(context,{}, {ownerId:'owner',device:{authKind:'cloud'}},{action}),/FORBIDDEN/);
  assert.equal(called,false);await assert.rejects(connectorExecution(context,{arguments:{},sessionId:'session'}),/TOOL_SOURCE_UNAVAILABLE/);
});
test('second-model review sees connector source identity, never returned external text', () => {
  const sources=reviewSourceLocations([{type:'tool/call',data:{callId:'read',name:'mcp__fixture__read_note',arguments:{}}},
    {type:'tool/result',data:{callId:'read',message:{content:[{type:'tool-result',content:'synthetic-private-external-text'}]}}}], 'next');
  assert.deepEqual(sources,['connector:mcp__fixture__read_note']);assert.ok(!JSON.stringify(sources).includes('private-external'));
});
test('managed DSH IPC preserves connector catalog and canonical result while retaining sender lifetime and identity', async () => {
  const sent:any[]=[],requests:any[]=[],tool={name:'mcp__c_fixture__read',rawName:'read',category:'read',parameters:{type:'object'},connectorId:'c_fixture',connectorName:'合成'};
  const runtime:any=new DshWebRuntime({homeDir:'C:\\synthetic\\home',workspaceDir:'C:\\synthetic\\work',personalDesktopRequestHandler:async request=>{
    requests.push(request);return request.action==='approval_policy'?{mode:'auto',allowedCategories:[],connectorTools:[tool],privateValue:'must-not-project'}:{content:[{type:'text',text:'[外部数据] synthetic'}],structuredContent:{count:3},privateValue:'must-not-project'};
  }});
  const child=Object.assign(new EventEmitter(),{connected:true,send:(message:any)=>sent.push(message)});runtime.registerChild(child);runtime.child=child;
  const identity={protocol:'weftmate.personal-desktop.v1',id:'personal-'+randomUUID(),sessionId:'session-synthetic',turn:0,callId:'approval-policy',messageHash:'a'.repeat(64)};
  runtime.handlePersonalDesktopMessage(child,{...identity,action:'approval_policy'});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(sent[0].command.connectorTools,[tool]);assert.equal(sent[0].command.privateValue,undefined);
  const call={...identity,id:'personal-'+randomUUID(),action:'connector_call',turn:1,callId:'call',rootCallId:'call',receiptId:'receipt',connectorId:'c_'+'a'.repeat(24),toolName:'mcp__c_fixture__read',arguments:{}};
  runtime.handlePersonalDesktopMessage(child,call);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests[1].runtimeId,runtime.personalRuntimeIds.get(child));assert.equal(sent[1].command.structuredContent.count,3);assert.equal(sent[1].command.privateValue,undefined);
  runtime.handlePersonalDesktopMessage(child,{...call,id:'personal-'+randomUUID(),arguments:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);
  runtime.child=null;runtime.handlePersonalDesktopMessage(child,{...call,id:'personal-'+randomUUID()});await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);assert.equal(sent.at(-1).ok,false);
});
