import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture(native = new Map<string,string>()) {
  const sandbox:any = { WeftUiCore: { factories: {} }, TextEncoder };
  runInNewContext(readFileSync('src/ui-core/message-actions.js','utf8'), sandbox);
  const store = new Map<string,string>(), sent:any[] = [];
  const core:any = {state:{ownerId:'synthetic',identityGeneration:1},
    cloudSendFeedback:async (body:any) => {sent.push(body);return {number:42}},
    accessApi:async () => ({runRecord:{summary:'{"platform":"windows","state":"ready"}'}})};
  Object.assign(core, sandbox.WeftUiCore.factories.messageActions(core,{}, {
    storage:{getItem:(key:string)=>store.get(key),setItem:(key:string,value:string)=>store.set(key,value)},
    feedbackStorage:async(key:string,value?:string)=>value===undefined?native.get(key):native.set(key,value)}));
  return {core,sent,native};
}
test('problem feedback excludes conversations by default, approved preview is sent verbatim, and records contain only metadata',async()=>{
  const f=fixture(), preview=f.core.feedbackPreview('少了最后一步',await f.core.feedbackDiagnostic());
  assert.doesNotMatch(preview.body,/附带对话|secret-message/);
  assert.equal(Object.isFrozen(preview),true);
  await f.core.sendProblemFeedback(preview);
  assert.equal(f.sent[0].title,preview.title);assert.equal(f.sent[0].body,preview.body);
  const record=(await fixture(f.native).core.readSentFeedback())[0];
  assert.equal(record.number,42); assert.deepEqual(Object.keys(record).sort(),['at','number','title']);
  const included=f.core.feedbackPreview('问题','', 'secret-message'); assert.match(included.body,/secret-message/);
  assert.throws(()=>f.core.feedbackPreview('问题','', '中'.repeat(21000)),/太大/);
  assert.throws(()=>f.core.feedbackPreview('  '),/一两句话/);
});
test('ratings can change and cancel and remain in account-scoped local storage',async()=>{
  const f=fixture();await f.core.saveMessageFeedback('s',2,'helpful');await f.core.saveMessageFeedback('s',2,'unhelpful');
  assert.equal(f.core.readMessageFeedback()[0].rating,'unhelpful');
  await f.core.saveMessageFeedback('s',2,null);assert.equal(f.core.readMessageFeedback().length,0);assert.equal(f.sent.length,0);
});
test('unlogged, unconfigured, rate limited, oversize and upstream failure explain recovery without success records',async()=>{
  const f=fixture();
  for(const [code,text]of [['FEEDBACK_LOGIN_REQUIRED','登录'],['FEEDBACK_NOT_CONFIGURED','暂未开通'],['RATE_LIMITED','太频繁'],['BODY_TOO_LARGE','太大'],['FEEDBACK_GITHUB_403','403']]) {
    f.core.cloudSendFeedback=async()=>{throw {code,retryAfter:600}};
    await assert.rejects(f.core.sendProblemFeedback(f.core.feedbackPreview('问题')));
    assert.match(f.core.feedbackError({code}),new RegExp(text));assert.match(f.core.feedbackError({code}),/复制/);
    assert.equal((await f.core.readSentFeedback()).length,0);
  }
});
test('cloud feedback uses existing authorized transport and refuses a local-only login',async()=>{
  const sandbox:any={WeftUiCore:{factories:{}},Date};
  runInNewContext(readFileSync('src/ui-core/cloud-account.js','utf8'),sandbox);
  const calls:any[]=[];
  sandbox.WeftUiCore.CloudAuthClient=class{authorized(path:string,options:any){calls.push({path,...options});return Promise.resolve({number:42})}};
  const core:any={state:{},load:()=>{},sessionExpired:()=>{},clearSession:()=>{}};
  Object.assign(core,sandbox.WeftUiCore.factories.cloudAccount(core,{},{}));core.initializeCloudAccount();
  core.state.cloudAuth.localSession=true;core.state.cloudAuth.mode='offline';
  await assert.rejects(core.cloudSendFeedback({title:'test',body:'test'}),{code:'FEEDBACK_LOGIN_REQUIRED'});
  core.state.cloudAuth.mode='authenticated';const payload={title:'test',body:'test'};await core.cloudSendFeedback(payload);
  assert.deepEqual(calls,[{path:'/feedback',method:'POST',body:payload}]);
});
