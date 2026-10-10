import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@deepseek-ai/dsh-llm')return {url:'data:text/javascript,export const createUserMessage = value => value',shortCircuit:true};return next(specifier,context)}});
const {nativeSessionLifecycle}=await import('../src/runtime/dsh-adapter/session-lifecycle.mjs');hooks.deregister();
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('personal preset reuse follows file generations, concurrent ids and disposal; other presets resolve normally',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-fx19-presets-')),file=join(root,'composition.yaml');
  let resolves=0,mounts=0,inherits=0,editDuringMount=false;
  const agents=new Map(),sessions=new Map();
  const presets={resolve:async(id)=>{resolves++;return {id,path:file}},
    mount:async(scoped,id)=>{mounts++;scoped.preset=id;scoped.generation=await readFile(file,'utf8');if(editDuringMount){editDuringMount=false;await writeFile(file,'generation-edited-during-mount')}},
    composeFrom:(scoped,source)=>{inherits++;Object.assign(scoped,source);return scoped.preset}};
  const persistence={config:{root},inspect:async(id)=>({meta:{id,agentPreset:'personal-remote'}}),
    locate:meta=>({kind:'jsonl',path:join(root,meta.id,'events')}),listSnapshots:async()=>[]};
  const ctx={get:name=>({agents:{get:id=>agents.get(id)},sessions:{get:id=>sessions.get(id)},agentPresets:presets,sessionPersistence:persistence}[name]),
    agents:{create:async({sessionId,meta,setup})=>{const scoped={on:()=>{}};await setup(scoped);
      const session={id:sessionId,header:{id:sessionId,...meta}},agent={ctx:scoped,session};agents.set(sessionId,agent);sessions.set(sessionId,session);
      await mkdir(join(root,sessionId));return {agent,dispose:async()=>{agents.delete(sessionId);sessions.delete(sessionId)}}}},sessions:{flush:async()=>{}}};
  try{
    await writeFile(file,'generation-one');const life=nativeSessionLifecycle(ctx);
    await life.create({sessionId:'one',agentPreset:'personal-remote'});
    await Promise.all(['two','three','four'].map(sessionId=>life.create({sessionId,agentPreset:'personal-remote'})));
    assert.equal(resolves,1);assert.equal(mounts,1);assert.equal(inherits,3);
    for(const id of ['one','two','three','four'])assert.equal(agents.get(id).ctx.generation,'generation-one');
    await writeFile(file,'generation-two-longer');await life.create({sessionId:'five',agentPreset:'personal-remote'});
    assert.equal(resolves,2);assert.equal(mounts,2);assert.equal(agents.get('five').ctx.generation,'generation-two-longer');
    assert.equal(agents.get('one').ctx.generation,'generation-one');
    await life.remove('five');await life.create({sessionId:'six',agentPreset:'personal-remote'});
    assert.equal(mounts,3,'disposed composition source must never be reused');
    await writeFile(file,'before-race');editDuringMount=true;await life.create({sessionId:'race',agentPreset:'personal-remote'});
    await life.create({sessionId:'after-race',agentPreset:'personal-remote'});
    assert.equal(agents.get('race').ctx.generation,'before-race');assert.equal(agents.get('after-race').ctx.generation,'generation-edited-during-mount');
    const before=resolves;await life.create({sessionId:'custom-one',agentPreset:'standard'});await life.create({sessionId:'custom-two',agentPreset:'standard'});
    assert.equal(resolves,before+2,'user-authored presets keep normal native discovery');
  }finally{await rm(root,{recursive:true,force:true})}
});

test('deletion removes disposed native subagent logs recursively while retaining independent forks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'weftmate-mem2-children-'));
  const headers=[{id:'parent',origin:'user'},{id:'child',origin:'subagent',parentSession:'parent'},
    {id:'nested',origin:'subagent',parentSession:'child'},{id:'fork',origin:'user',parentSession:'parent'}];
  const deleted=[];
  try {
    for(const header of headers){await mkdir(join(root,header.id));await writeFile(join(root,header.id,'events'),'synthetic');}
    const persistence={config:{root},inspect:async()=>({meta:headers[0]}),locate:header=>({kind:'jsonl',path:join(root,header.id,'events')}),
      listSnapshots:async()=>headers.map(header=>({header}))};
    const ctx={get:name=>({sessionPersistence:persistence,sessions:{get:()=>null},agents:{get:()=>null},
      storageDomain:{get:()=>({table:()=>({delete:async id=>deleted.push(id)})})}}[name])};
    assert.equal((await nativeSessionLifecycle(ctx).remove('parent')).deleted,true);
    for(const id of ['parent','child','nested'])await assert.rejects(stat(join(root,id)),{code:'ENOENT'});
    assert.ok(await stat(join(root,'fork')));assert.deepEqual(deleted,['nested','child','parent']);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('concurrent cold resumes share a native handle and model reads finish before forgetting disposes it',async()=>{
  let agent,starts=0,release;const calls=[];
  const started=new Promise(resolve=>release=resolve);
  const persistence={config:{root:'C:/synthetic'},inspect:async()=>({meta:{id:'session',agentPreset:'personal-remote'}}),readRaw:async()=>({meta:{id:'session'},content:'{"kind":"header"}\n'})};
  const ctx={get(name){return {sessionPersistence:persistence,agents:{get:()=>agent},sessions:{get:()=>undefined},
    agentPresets:{resolve:async()=>({id:'personal-remote'})},storageDomain:{get:()=>({table:()=>({delete:async()=>calls.push('cache-delete')})})}}[name]},
    agents:{resume:async()=>{starts++;await started;agent={session:{id:'session',events:[],surface:{nodes:[]}},status:'idle',inbox:{hasPending:false}};return {agent,dispose:async()=>{calls.push('dispose');agent=undefined}}}},
    sessions:{flush:async()=>calls.push('flush')}};
  const lifecycle=nativeSessionLifecycle(ctx),one=lifecycle.resume('session'),two=lifecycle.resume('session');
  await tick();assert.equal(starts,1);release();await Promise.all([one,two]);assert.equal(starts,1);
  let finish;const model=lifecycle.use('session',()=>new Promise(resolve=>{finish=()=>{calls.push('model-read');resolve()}}));
  await tick();const forgetting=lifecycle.cleanupMemory('session');await tick();assert.deepEqual(calls,[]);
  finish();await Promise.all([model,forgetting]);assert.deepEqual(calls,['model-read','flush','dispose','cache-delete']);
});
