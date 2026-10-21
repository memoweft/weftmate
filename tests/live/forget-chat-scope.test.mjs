// Opt-in paid behavior regression; deliberately outside the ordinary CI glob.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {classifyForgetRequest} from '../../src/personal-memory/forget-model.mjs';

if(process.env.WEFTMATE_LIVE_FORGET_AUTHORIZED!=='1')throw Error('Live model validation NOT RUN: explicit model-call authorization is required; see tests/live/README.md');
const baseUrl=process.env.WEFTMATE_LIVE_MODEL_BASE_URL,model=process.env.WEFTMATE_LIVE_MODEL_ID,credential=process.env.WEFTMATE_LIVE_MODEL_KEY;
if(!baseUrl||!model||!credential||!process.env.WEFTMATE_EVIDENCE_DIR)throw Error('Live model validation NOT RUN: explicit model configuration, credential and a fresh evidence directory are required');
const output=resolve(process.env.WEFTMATE_EVIDENCE_DIR);
await mkdir(output); // Existing evidence must never be overwritten by a rerun.
const fixtures=JSON.parse(await readFile(new URL('../fixtures/forget-intent-chat-scope.json',import.meta.url),'utf8'));
const source=await readFile(new URL('../../src/personal-memory/forget-model.mjs',import.meta.url));
const classifierSha256=createHash('sha256').update(source).digest('hex');
const endpoint=new URL(baseUrl);
const configuration={model,endpoint:endpoint.origin+endpoint.pathname,node:process.versions.node};
const nativeFetch=globalThis.fetch;let calls;
globalThis.fetch=async(input,init)=>{
  // Preserve the actual request and response, never transport headers/keys.
  const entry={request:JSON.parse(init.body)};calls.push(entry);
  const response=await nativeFetch(input,init);
  entry.status=response.status;entry.response=await response.clone().json();
  return response;
};
test.after(()=>{globalThis.fetch=nativeFetch;});
for(const fixture of fixtures)test(fixture.id,{timeout:125000},async()=>{
  calls=[];const row={id:fixture.id,message:fixture.message,expected:fixture.authorized,classifierSha256,configuration,startedAt:new Date().toISOString()};
  try{
    row.actual=await classifyForgetRequest({baseUrl,model,credential,signal:AbortSignal.timeout(120000)},fixture.message);
    assert.equal(row.actual.authorized,fixture.authorized);row.passed=true;
  }catch(error){row.passed=false;row.error=error.name;throw error;}
  finally{
    row.calls=calls;row.finishedAt=new Date().toISOString();
    await writeFile(join(output,fixture.id+'.json'),JSON.stringify(row,null,2).replaceAll(credential,'[redacted]'),{flag:'wx'});
  }
});
