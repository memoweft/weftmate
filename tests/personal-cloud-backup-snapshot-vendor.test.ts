import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,mkdir,readdir,cp,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {snapshot,verify} from '../src/personal-backup/archive.mjs';
import {createNativeSettingsReader} from '../src/personal-backup/cloud-snapshot.mjs';
import {stageRuntimeEntry} from '../scripts/windows-package-policy.mjs';
import {prepareWindowsRuntimeComponents} from '../scripts/windows-runtime-components.mjs';
import {packagedRuntimeDirectory} from '../src/runtime-components.mjs';
import {owner,other,sha,fixture} from './helpers/cloud-backup-snapshot-fixture.mjs';

for(const versioned of [false,true])test(`S4 ${versioned?'versioned':'legacy'} packaged resources create a scoped cloud snapshot without profile or repository runtime`,async t=>{
  const f=await fixture(t),runtime=await realpath('vendor/dsh-runtime'),resourcesPath=path.join(f.base,'installed/resources'),target=path.join(resourcesPath,'dsh-runtime');
  const build=JSON.parse(await readFile('package.json','utf8')).build;
  assert.ok(build.extraResources.some(row=>row.from==='.stage'&&row.to===''&&row.filter.includes('dsh-runtime/**/*')));
  const yaml=path.join(runtime,'node_modules/yaml');
  async function check(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);assert.ok(stageRuntimeEntry(path.relative(runtime,file)),file);if(entry.isDirectory())await check(file);}}
  await check(yaml);
  await mkdir(path.join(target,'node_modules'),{recursive:true});await cp(yaml,path.join(target,'node_modules/yaml'),{recursive:true});
  await writeFile(path.join(target,'package.json'),await readFile(path.join(runtime,'package.json')));
  if(versioned){
    const memory=path.join(resourcesPath,'memory-runtime');await mkdir(memory);await writeFile(path.join(memory,'fixture'),'synthetic');
    await prepareWindowsRuntimeComponents({appOutDir:path.dirname(resourcesPath),packager:{projectDir:f.base,config:{appId:'test.backupcomponents'}}});
  }
  const anchor=path.join(packagedRuntimeDirectory(resourcesPath,'dsh-runtime'),'package.json'),attempts=[];
  const nativeSettingsReader=createNativeSettingsReader({resourcesPath,requireModule:location=>module=>{
    attempts.push(location);if(location!==anchor)throw Object.assign(new Error('synthetic absent development runtime'),{code:'MODULE_NOT_FOUND'});
    return createRequire(location)(module);
  }});
  const provider=`weftmate-${sha('model-a').slice(0,24)}`;
  await f.put('weftmate-settings.json',{schemaVersion:3,models:{profiles:[{id:'model-a'}],activeId:'model-a'}});
  await f.put('dsh-home/settings.yaml',`llm-pi-ai:\n  providers:\n    ${provider}: {apiKeyEnv: synthetic-package-credential}\n    unowned: {displayName: other-provider-secret}\nother-namespace: {notes: other-namespace-secret}\n`);
  const row=await snapshot({...f,cloudOwnerId:owner,nativeSettingsReader}),stage=path.join(f.base,'extracted');await verify(path.join(f.directory,row.id),stage);
  assert.equal(attempts.length,3);assert.equal(attempts[2],anchor);
  assert.deepEqual(JSON.parse(await readFile(path.join(stage,'dsh-home/settings.yaml'),'utf8')),{'llm-pi-ai':{providers:{[provider]:{apiKeyEnv:'synthetic-package-credential'}}}});
  assert.equal(row.manifest.cloud.modelCredentialRefs[0].credentialRef,'synthetic-package-credential');
  const bytes=gunzipSync(await readFile(path.join(f.directory,row.id))).toString('utf8');assert.ok(!bytes.includes('other-provider-secret'));assert.ok(!bytes.includes('other-namespace-secret'));
});

test('S4 cloud snapshot excludes file bodies while keeping own conversation experience and account configuration', async t => {
  const f = await fixture(t); f.store.accounts[owner].sessions['session-a'] = { ownerId: owner, modelProfileId: 'model-a' }; await f.put('personal-access/store.json', f.store);
  const own = `conversations/${sha(owner)}/session-a`, others = `conversations/${sha(other)}/session-a`;
  for (const [name, content] of Object.entries({
    [`${own}/经验.md`]: 'own experience', [`${own}/large.pdf`]: 'original user file secret', [`${others}/经验.md`]: 'other experience secret',
    'workspace/notes.txt': 'workspace secret', 'desktop-artifacts/export.txt': 'desktop artifact secret', 'personal-access/artifacts/large.txt': 'library body secret',
    [`personal-access/accounts/${owner}/sync/attachments/file.bin`]: 'attachment secret', [`personal-access/accounts/${owner}/sync/shared-attachments/file.image`]: 'image secret',
    'dsh-home/settings.yaml': JSON.stringify({ 'other-namespace': { secret: 'provider secret' } }), 'unknown-data/other-account.json': 'unknown secret', 'weftmate-model.enc': 'encrypted vault secret',
  })) await f.put(name, content);
  await f.put('weftmate-settings.json', { schemaVersion: 3, appearance: { theme: 'dark' }, models: { profiles: [{ id: 'model-a', name: 'own' }, { id: 'private-model-other', name: 'other model secret' }], activeId: 'model-a' }, sessionBindings: { 'session-a': { profileId: 'model-a' }, 'session-b': { profileId: 'private-model-other' } } });
  const row = await snapshot({ ...f, cloudOwnerId: owner }), bytes = gunzipSync(await readFile(path.join(f.directory, row.id))).toString('utf8');
  assert.ok(bytes.includes('own experience')); assert.ok(bytes.includes('"theme":"dark"'));
  for (const text of ['original user file secret', 'other experience secret', 'workspace secret', 'desktop artifact secret', 'library body secret', 'attachment secret', 'image secret', 'provider secret', 'unknown secret', 'other model secret', 'encrypted vault secret']) assert.ok(!bytes.includes(text), text);
  const local = await snapshot(f), localManifest = await verify(path.join(f.directory, local.id));
  assert.ok(localManifest.files.some(row => row.path === `${own}/large.pdf`), 'ordinary local backup behavior remains unchanged');
});

test('S4 cloud backup preserves only owned official model providers and paired migration marker', async t => {
  const f = await fixture(t), ownRoute = `weftmate-${sha('model-a').slice(0, 24)}`, otherRoute = `weftmate-${sha('private-model-other').slice(0, 24)}`;
  await f.put('weftmate-settings.json', { schemaVersion: 3, models: { profiles: [{ id: 'model-a' }, { id: 'private-model-other' }], activeId: 'model-a' } });
  const provider = { apiKeyEnv: 'synthetic-formal-credential-ref', api: 'openai-completions', baseURL: 'https://synthetic.invalid/v1', models: [{ id: 'synthetic-model', contextWindow: 131072, maxTokens: 4096 }] };
  await f.put('dsh-home/settings.yaml', `llm-pi-ai:\n  providers:\n    ${ownRoute}: ${JSON.stringify(provider)}\n    ${otherRoute}: {displayName: other-provider-secret}\nother-namespace:\n  notes: other-namespace-secret\n`);
  await f.put('dsh-home/weftmate-stage2-official-routes-migration.json', { schemaVersion: 1, authority: 'official-dsh-user-settings', routes: [ownRoute, otherRoute] });
  let captured;
  const row = await snapshot({ ...f, cloudOwnerId: owner, captureSecrets: async metadata => { captured = metadata; return null; } }), extracted = path.join(f.base, 'extracted');
  await verify(path.join(f.directory, row.id), extracted);
  assert.deepEqual(JSON.parse(await readFile(path.join(extracted, 'dsh-home/settings.yaml'), 'utf8')), { 'llm-pi-ai': { providers: { [ownRoute]: provider } } });
  assert.deepEqual(JSON.parse(await readFile(path.join(extracted, 'dsh-home/weftmate-stage2-official-routes-migration.json'), 'utf8')).routes, [ownRoute]);
  assert.deepEqual(captured.modelCredentialRefs, [{ profileId: 'model-a', provider: ownRoute, credentialRef: 'synthetic-formal-credential-ref' }]);
  const bytes = gunzipSync(await readFile(path.join(f.directory, row.id))).toString('utf8'); assert.ok(!bytes.includes('other-provider-secret')); assert.ok(!bytes.includes('other-namespace-secret'));
  await rm(path.join(f.root, 'dsh-home/settings.yaml'));
  const unpaired = await snapshot({ ...f, cloudOwnerId: owner }); assert.ok(!unpaired.manifest.files.some(row => row.path.endsWith('official-routes-migration.json')));
});
