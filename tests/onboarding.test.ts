import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { discoverModels, privateModelAddress, defaultModelPorts } from '../src/personal-access/onboarding.mjs';

test('discovery reads directories only, never adds or invokes a model, and rejects public/credential URLs', async () => {
  const calls: string[] = [];
  const results = await discoverModels({ addresses: ['http://127.0.0.1:49123/v1'], neighbors: [], fetchImpl: async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    return new Response(JSON.stringify({ data: url.includes('49123') ? [{id:'fixture'}, {id:'invalid id'}] : [] }));
  } });
  assert.deepEqual(results, [{baseUrl:'http://127.0.0.1:49123/v1',models:['fixture']}]);
  assert.equal(calls.some(url => url.includes('8081') || !url.endsWith('/models')), false);
  assert.equal(defaultModelPorts.includes(8081), false);
  for (const url of ['https://example.com/v1','http://127.0.0.1:8081/v1','http://127.0.0.1.evil.example/v1','http://key@localhost/v1','http://localhost/v1?key=x']) assert.throws(() => privateModelAddress(url));
});

test('fresh installation progress survives restart, completed state persists, old stores are not enrolled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-onb-unit-'));
  const backend = Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(key => [key,async()=>key==='listModels'?[]:{}]));
  let host;
  try {
    host = await createPersonalAccessService({root,port:0,backend}); let started = await host.start();
    const get = () => fetch(started.origin+'/personal/v1/onboarding').then(r=>r.json());
    assert.deepEqual((await get()).onboarding,{step:'welcome',completed:false,started:false});
    const update = (body: unknown, origin = started.origin) => fetch(started.origin+'/personal/v1/onboarding',{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await update({step:'memory',completed:false},'https://unrelated.example')).status,403);
    assert.equal((await update({step:'invalid',completed:false})).status,400);
    assert.equal((await update({step:'memory',completed:false})).status,200);
    await host.close(); host = await createPersonalAccessService({root,port:0,backend}); started = await host.start();
    assert.equal((await get()).onboarding.step,'memory');
    for (const step of ['welcome','account','model','memory','import','phone','first']) { assert.equal((await update({step,completed:false})).status,200); assert.equal((await get()).onboarding.step,step); }
    assert.equal((await update({step:'first',completed:true})).status,200);
    await host.close();
    const store = JSON.parse(await readFile(join(root,'store.json'),'utf8')); delete store.onboarding; await writeFile(join(root,'store.json'),JSON.stringify(store));
    host = await createPersonalAccessService({root,port:0,backend}); started = await host.start(); assert.equal((await get()).onboarding,null);
  } finally { await host?.close(); await rm(root,{recursive:true,force:true}); }
});
