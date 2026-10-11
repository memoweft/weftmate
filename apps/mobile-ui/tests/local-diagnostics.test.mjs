import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../www/components/local-diagnostics.js',import.meta.url),'utf8');
function fixture(extra={}){
    const values=new Map(),listeners={};
    const context={URL,TextEncoder,Date,location:{href:'https://synthetic.invalid/mobile/index.html'},
        crypto:{randomUUID:()=> '12345678-1234-4234-8234-123456789abc'},
        localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
        addEventListener:(event,handler)=>{listeners[event]=handler;},...extra};
    runInNewContext(source,context);return {api:context.WeftLocalDiagnostics,values,listeners};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('default error text is suppressed after safe runtime recording',()=>{
    const f=fixture();let suppressed=0;
    f.listeners.error({error:{name:'TypeError',message:'private body'},preventDefault:()=>suppressed++});
    f.listeners.unhandledrejection({reason:{name:'RangeError',message:'private prompt'},preventDefault:()=>suppressed++});
    assert.equal(suppressed,2);assert.equal(f.api.status().records.length,2);
    assert.ok(!f.api.status().summary.includes('private'));
});
const privateExamples=[
    ['conversation','private conversation body'],['prompt','private prompt'],['model output','private model output'],
    ['file content','private file content'],['file name','private-notes.txt'],['account name','private-account'],
    ['email','synthetic@example.invalid'],['device name','synthetic-private-device'],
    ['server address','https://server.invalid:1234'],['domain','server.invalid'],['IP','192.0.2.9'],
    ['key','sk-synthetic-secret-key'],['token','synthetic-private-token'],['Cookie','Cookie: session=private'],
    ['authorization','Authorization: Bearer private'],['query','?token=private'],['random string','aB91xK73nP02dQ49vR65tZ18mS28'],
];
for(const [category,secret]of privateExamples)test(`local diagnostics drops ${category} and preserves fixed technical fields`,()=>{
    const f=fixture(),raw={source:'web-error',name:'TypeError',script:'app.js',line:12,column:3,
        message:secret,stack:secret,content:secret,account:secret,url:secret,filename:secret};
    assert.deepEqual(plain(f.api.sanitize(raw)),{source:'web-error',name:'TypeError',script:'app.js',line:12,column:3});
    assert.deepEqual(plain(f.api.sanitize({name:secret,script:secret,line:secret,column:secret,source:secret})),{source:'web-error',name:'Error'});
});
test('location only retains our exact script path and numeric coordinates, never origin or query',()=>{
    const api=fixture().api;
    assert.deepEqual(plain(api.location('https://synthetic.invalid/mobile/components/settings.js?secret=private',12,3)),{script:'settings.js',line:12,column:3});
    assert.deepEqual(plain(api.location('https://synthetic.invalid/mobile/ui-core/adapters/mobile-host.js',12,3)),{script:'mobile-host.js',line:12,column:3});
    for(const url of ['https://external.invalid/mobile/app.js','https://synthetic.invalid/private/app.js',
        'https://synthetic.invalid/mobile/private-notes.txt','https://synthetic.invalid/mobile/private/app.js',
        'https://private:secret@synthetic.invalid/mobile/app.js'])assert.deepEqual(plain(api.location(url,12,3)),{});
    assert.deepEqual(plain(api.location('app.js',-1,Infinity)),{script:'app.js'});
});
test('window errors and rejected promises retain type and own script location while dropping raw stack',()=>{
    const f=fixture();
    assert.deepEqual(plain(f.api.fromEvent({error:{name:'ReferenceError',message:'private'},filename:'https://synthetic.invalid/mobile/app.js?token=private',lineno:22,colno:4},'web-error')),
        {source:'web-error',name:'ReferenceError',script:'app.js',line:22,column:4});
    const error={name:'TypeError',message:'private',stack:'TypeError: private\n at private (https://external.invalid/app.js:8:1)\n at private (https://synthetic.invalid/mobile/components/chat.js?private:33:2)'};
    assert.deepEqual(plain(f.api.fromEvent({reason:error},'web-rejection')),{source:'web-rejection',name:'TypeError',script:'chat.js',line:33,column:2});
    assert.deepEqual(plain(f.api.fromEvent({reason:'private rejection text'},'web-rejection')),{source:'web-rejection',name:'Error'});
});
test('browser diagnostics are bounded, retained for 7 days, scrubbed again on read and sequenced within a run',()=>{
    const f=fixture();for(let i=0;i<35;i++)f.api.record({name:'Error',script:'app.js',message:'private',line:i+1});
    const summary=JSON.parse(f.api.status().summary);assert.equal(summary.recentAbnormalRecords.length,20);
    assert.equal(new TextEncoder().encode([...f.values.values()][0]).length<=16*1024,true);
    assert.equal(summary.recentAbnormalRecords.at(-1).fields.recordIndex,'35');assert.equal(summary.abnormalCountsLast7Days['app.failure'],20);
    assert.equal(summary.retentionPolicy.retentionDays,7);assert.equal(summary.retentionPolicy.maxBytes,16384);
    const record=f.api.status().records[0];
    const pruned=f.api.prune([{...record,at:new Date(Date.now()-8*86400000).toISOString()},
        {...record,message:'private',unexpected:'private'}, {...record,runId:'private account'}]);
    assert.equal(pruned.length,1);assert.equal(JSON.stringify(pruned).includes('private'),false);
});
test('blocked storage is nonfatal and retains a small in-memory fallback',()=>{
    const f=fixture({localStorage:{getItem:()=>null,setItem:()=>{throw Error('blocked');}}});
    for(let n=0;n<3;n++)f.listeners.error({error:{name:'TypeError'}});
    assert.equal(JSON.parse(f.api.status().summary).recentAbnormalRecords.length,3);
});
test('native runtime records go through generic diagnostics.record and do not enter browser storage',async()=>{
    const calls=[],f=fixture({weftNative:{}});f.api.configure(async(method,params)=>calls.push({method,params}));
    f.listeners.unhandledrejection({reason:{name:'TypeError',message:'private'}});
    for(let n=0;n<3;n++)await Promise.resolve();
    assert.deepEqual(plain(calls),[{method:'diagnostics.record',params:{source:'web-rejection',name:'TypeError'}}]);assert.equal(f.values.size,0);
});
test('native startup failure before bridge configuration sends only sanitized fields',()=>{
    const calls=[],f=fixture({weftNative:{postMessage:message=>calls.push(JSON.parse(message))}});
    f.listeners.error({error:{name:'RangeError',message:'private'},filename:'https://external.invalid/private.js'});
    assert.deepEqual(plain(calls),[{id:'diag1',method:'diagnostics.record',params:{source:'web-error',name:'RangeError'}}]);assert.equal(f.values.size,0);
});
