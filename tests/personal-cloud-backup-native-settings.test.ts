import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {snapshot,verify} from '../src/personal-backup/archive.mjs';
import {createNativeSettingsReader} from '../src/personal-backup/cloud-snapshot.mjs';
import {owner,sha,fixture} from './helpers/cloud-backup-snapshot-fixture.mjs';

const missing = () => { throw Object.assign(new Error('synthetic missing parser'), {code:'MODULE_NOT_FOUND'}); };

test('S4 absent native settings need no parser; missing runtime locations report a stable error and retry',async t=>{
  const f=await fixture(t);
  for(const resourcesPath of [undefined,path.join(f.base,'synthetic-resources')]){
    const attempts=[];
    const reader=createNativeSettingsReader({resourcesPath,requireModule:anchor=>module=>{attempts.push({anchor,module});return missing();}});
    assert.equal(await reader(f.root),null);assert.equal(attempts.length,0);
    await f.put('dsh-home/settings.yaml','llm-pi-ai: {}');
    for(let retry=1;retry<=2;retry++){
      await assert.rejects(reader(f.root),error=>error.code==='RUNTIME_UNAVAILABLE'&&!(error instanceof TypeError));
      assert.equal(attempts.length,retry*(resourcesPath?3:2));
    }
    assert.ok(attempts.every(row=>typeof row.anchor==='string'));
    assert.match(attempts[0].anchor,/dsh-settings-file[\\/]package\.json$/);
    assert.equal(attempts[1].module,'../../vendor/dsh-runtime/node_modules/yaml');
    if(resourcesPath)assert.equal(attempts[2].anchor,path.join(resourcesPath,'dsh-runtime/package.json'));
    await (await import('node:fs/promises')).rm(path.join(f.root,'dsh-home/settings.yaml'));
  }
});

test('S4 parser absence cannot publish an incomplete or unscoped cloud snapshot; retry preserves owned providers',async t=>{
  const f=await fixture(t),previous=await snapshot({...f,cloudOwnerId:owner});
  const provider=`weftmate-${sha('model-a').slice(0,24)}`;
  await f.put('weftmate-settings.json',{schemaVersion:3,models:{profiles:[{id:'model-a'}],activeId:'model-a'}});
  const settings={'llm-pi-ai':{providers:{[provider]:{apiKeyEnv:'synthetic-owned-key'},unowned:{displayName:'other-provider-secret'}}},'other-namespace':{value:'other-namespace-secret'}};
  await f.put('dsh-home/settings.yaml',settings);
  const before=await readFile(path.join(f.root,'dsh-home/settings.yaml')),filesBefore=await readdir(f.directory);
  let credentials=0;
  const nativeSettingsReader=createNativeSettingsReader({resourcesPath:path.join(f.base,'resources'),requireModule:()=>missing});
  await assert.rejects(snapshot({...f,cloudOwnerId:owner,nativeSettingsReader,captureSecrets:async()=>{credentials++;return {};}}),{code:'RUNTIME_UNAVAILABLE'});
  assert.equal(credentials,0);assert.deepEqual(await readdir(f.directory),filesBefore);
  assert.deepEqual(await readFile(path.join(f.root,'dsh-home/settings.yaml')),before);
  assert.equal((await verify(path.join(f.directory,previous.id))).format,'weftmate-local-backup');
  const jsonParser={parseDocument:text=>({errors:[],toJS:()=>JSON.parse(text)})};
  const retryReader=createNativeSettingsReader({resourcesPath:path.join(f.base,'resources'),requireModule:anchor=>module=>{
    if(anchor!==path.join(f.base,'resources/dsh-runtime/package.json'))return missing();
    assert.equal(module,'yaml');return jsonParser;
  }});
  const restored=await snapshot({...f,cloudOwnerId:owner,nativeSettingsReader:retryReader}),stage=path.join(f.base,'extracted');
  await verify(path.join(f.directory,restored.id),stage);
  assert.deepEqual(JSON.parse(await readFile(path.join(stage,'dsh-home/settings.yaml'),'utf8')),{'llm-pi-ai':{providers:{[provider]:settings['llm-pi-ai'].providers[provider]}}});
});

test('S4 invalid native settings fail explicitly rather than entering an unfiltered snapshot',async t=>{
  const f=await fixture(t);await f.put('dsh-home/settings.yaml','synthetic invalid document');
  const nativeSettingsReader=createNativeSettingsReader({requireModule:()=>()=>({parseDocument:()=>({errors:[new Error('synthetic syntax')],toJS:()=>assert.fail('invalid document must not be read')})})});
  await assert.rejects(snapshot({...f,cloudOwnerId:owner,nativeSettingsReader}),{code:'BACKUP_CORRUPT'});
  assert.deepEqual(await readdir(f.directory),[]);
});
