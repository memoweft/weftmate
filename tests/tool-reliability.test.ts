import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelToolFailure } from '../src/plugins/personal-reply-content.mjs';
import { trackNativeFiles, appendNativeArtifacts } from '../src/plugins/personal-native-files.mjs';
import { syncConnectorTools } from '../src/plugins/personal-connectors.mjs';

test('model receives actionable argument errors and cancellation without permission to replay effects', () => {
  const invalid = modelToolFailure('weftmod', { isError:true, error:{name:'ToolArgsError',code:'INVALID_ARGS',message:'invalid arguments: args.desktop must be object'},content:[] });
  assert.match(JSON.stringify(invalid), /args.desktop must be object/);
  assert.match(JSON.stringify(invalid), /not_started/);
  const memoryInvalid=modelToolFailure('memory_query',{isError:true,error:{info:{name:'ToolArgsError',code:'INVALID_ARGS'},message:'invalid arguments: args.query must be string'},content:[]});
  assert.match(JSON.stringify(memoryInvalid),/args.query must be string/);
  const cancelled = modelToolFailure('pwsh', {isError:true,error:{name:'AbortError',message:'cancelled'},content:[]});
  assert.match(JSON.stringify(cancelled), /cancelled/);
  assert.match(JSON.stringify(cancelled), /do_not_retry/);
  const unknown = modelToolFailure('pwsh', {isError:true,error:{message:'executor transport lost'},content:[]});
  assert.match(JSON.stringify(unknown), /verify_before_retry/);
  const denied=modelToolFailure('pwsh',{isError:true,error:{code:'FORBIDDEN',message:'forbidden'},content:[]});
  assert.match(JSON.stringify(denied),/permission_denied/);assert.match(JSON.stringify(denied),/do_not_retry/);
  const secret=modelToolFailure('web_fetch',{isError:true,error:{message:'authorization: Bearer synthetic-secret api_key="synthetic-key" https://user:synthetic-password@example.invalid'},content:[]});
  assert.doesNotMatch(JSON.stringify(secret),/synthetic-secret|synthetic-key|synthetic-password/);
});

test('non-file tools do not inspect the workspace, even when it cannot be enumerated', async t => {
  const root = await mkdtemp(join(tmpdir(),'weftmate-tool-reliability-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const blocked = join(root,'not-a-directory'); await writeFile(blocked,'synthetic');
  for(const name of ['load_tools','read','browser','schedule_list','weftmod','health_query','mcp__c_fixture']){
    let calls=0; const result={isError:false,content:[]};
    assert.equal(await trackNativeFiles({}, {name,arguments:{},agent:{session:{header:{agentPreset:'personal-remote',cwd:blocked}}}},async()=>{calls++;return result;},()=>({})),result);
    assert.equal(calls,1);
  }
});

test('file registration failure preserves the successful effect and reports observation separately', async t => {
  const root=await mkdtemp(join(tmpdir(),'weftmate-tool-reliability-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'written.txt'),exec={name:'write',arguments:{file_path:file},agent:{session:{header:{agentPreset:'personal-remote',cwd:root}}}};
  const native={isError:false,content:[{type:'text',text:'written'}]};let calls=0;
  const result=await trackNativeFiles({request:async()=>{throw Error('synthetic registration failure');}},exec,async()=>{calls++;await writeFile(file,'once');return native;},()=>({}));
  assert.equal(result,native);assert.equal(calls,1);assert.equal(await readFile(file,'utf8'),'once');
  const projected=await appendNativeArtifacts(exec,result,async()=>({kind:'accept'}));
  assert.match(JSON.stringify(projected.content),/artifactObservation/);
  assert.match(JSON.stringify(projected.content),/do_not_repeat/);
});

test('structured connector results remain visible to the model', () => {
  const definitions:any[]=[]; const agent={ctx:{tools:{register:(d:any)=>{definitions.push(d);return ()=>{};}}}};
  syncConnectorTools(agent,{connectorTools:[{name:'mcp__c_fixture',connectorName:'fixture',description:'fixture',parameters:{type:'object',properties:{}},category:'read'}]}, {},()=>({}));
  const rendered=definitions[0].output.render({}, {content:[],structuredContent:{items:[{title:'synthetic-result'}]}});
  assert.match(JSON.stringify(rendered),/synthetic-result/);
  assert.match(JSON.stringify(rendered),/外部数据/);
});
