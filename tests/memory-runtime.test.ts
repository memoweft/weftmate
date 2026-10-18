import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import 'app-builder-lib';
const {WinPackager}=await import('app-builder-lib/out/winPackager.js');
import {modeOf,verifyMemoryRuntime,lock} from '../scripts/memory-runtime/verify.mjs';
import {checkInput} from '../scripts/memory-runtime/prepare.mjs';
import {withMemoryRuntimeResources,beforeWindowsMemoryPack,afterWindowsMemoryPack} from '../scripts/memory-runtime-package.mjs';
import {memoryRuntimeFixture,sealMemoryRuntimeFixture} from './helpers/memory-runtime-fixture.mjs';

test('fixed inputs reject altered archives and preparation requires an explicit valid layer',async()=>{
  assert.throws(()=>checkInput(Buffer.from('altered'),{file:'synthetic.zip',sha256:'0'.repeat(64)}),/hash\/size mismatch/);
  for(const mode of [undefined,'','auto','none'])assert.throws(()=>modeOf(mode),/explicit/);
  for(const mode of ['base','full'])assert.equal(modeOf(mode),mode);
  await assert.rejects(withMemoryRuntimeResources({}, {mode:'base',source:''}),/prepared memory runtime directory/);
  // Existing beforePack/afterPack remain inert for other operating systems.
  await beforeWindowsMemoryPack({electronPlatformName:'darwin'});
  await afterWindowsMemoryPack({electronPlatformName:'linux'});
});

test('packaging defaults to the approved full layer and preserves official Python bytes during signing',async()=>{
  const calls=[];
  const verify=async(source,options)=>{calls.push({source,...options});return {manifestSha256:'a'.repeat(64)};};
  const previous=process.env.WEFTMATE_MEMORY_RUNTIME_MODE;
  delete process.env.WEFTMATE_MEMORY_RUNTIME_MODE;
  let config;
  try{config=await withMemoryRuntimeResources({}, {source:'synthetic-payload'},verify);}
  finally{if(previous===undefined)delete process.env.WEFTMATE_MEMORY_RUNTIME_MODE;else process.env.WEFTMATE_MEMORY_RUNTIME_MODE=previous;}
  assert.equal(config.extraMetadata.memoryRuntimeMode,'full');
  assert.equal(config.extraMetadata.memoryRuntimeManifestSha256,'a'.repeat(64));
  assert.equal(calls[0].mode,'full');
  const packager={platformSpecificBuildOptions:config.win};
  const sign=file=>WinPackager.prototype.shouldSignFile.call(packager,file);
  assert.equal(sign(resolve('synthetic-payload/python/python.exe')),false);
  assert.equal(sign(resolve('synthetic-payload/python/pythonw.exe')),false);
  assert.equal(sign(resolve('other-payload/python/python.exe')),true);
  assert.equal(sign(resolve('synthetic-payload/python/mypython.exe')),true);
  assert.equal(sign(resolve('dsh-runtime/node_modules/node-pty/winpty-agent.exe')),true);
  assert.equal(sign('WeftMate.exe'),true);
  assert.equal(sign('WeftMate-Setup-1.0.0.exe'),true);
  packager.shouldSignFile=WinPackager.prototype.shouldSignFile;
  const transformer=WinPackager.prototype.createTransformerForExtraFiles.call(packager,{appOutDir:resolve('synthetic-app')});
  assert.equal(transformer(resolve('synthetic-payload/python/python.exe')),null);
  assert.equal(transformer(resolve('synthetic-payload/python/pythonw.exe')),null);
  assert.equal(typeof transformer(resolve('dsh-runtime/winpty-agent.exe')).afterCopyTransformer,'function');
  const signed=[];
  packager.signingQueue=Promise.resolve();packager._sign=async file=>{signed.push(file);return true;};
  assert.equal(await WinPackager.prototype.signIf.call(packager,resolve('synthetic-payload/python/python.exe')),false);
  for(const file of ['WeftMate.exe','WeftMate-Setup-1.0.0.exe','dsh-runtime/winpty-agent.exe'])assert.equal(await WinPackager.prototype.signIf.call(packager,resolve(file)),true);
  assert.equal(signed.length,3);
});

test('payload verification catches missing, corrupted, mixed-version and undeclared files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-runtime-test-'));
  try{
    await memoryRuntimeFixture(root);
    const verify=()=>verifyMemoryRuntime(root,{mode:'base'});
    assert.equal((await verify()).mode,'base');
    // A payload/cache from before the accepted Core update cannot pass as
    // either selected layer, even if its file inventory was resealed.
    for(const mode of ['base','full'])for(const core of [
      'e86b73ba9570a9bd490ef90bfb7059574de5e449',
      '52952ff0e896d745e3c6ec65579ea643f8b996fb',
    ]){
      await sealMemoryRuntimeFixture(root,{mode,core});
      await assert.rejects(verifyMemoryRuntime(root,{mode}),/version\/platform\/layer mismatch/);
    }
    await sealMemoryRuntimeFixture(root);
    await assert.rejects(verifyMemoryRuntime(root,{mode:'full'}),/version\/platform\/layer mismatch/);
    const file=join(root,'python/python.exe'),original=await readFile(file);
    await writeFile(file,'changed');await assert.rejects(verify(),/hash-mismatched/);
    await writeFile(file,original);await rm(file);await assert.rejects(verify(),/hash-mismatched/);
    await sealMemoryRuntimeFixture(root);await assert.rejects(verify(),/required file missing/);
    await writeFile(file,original);await sealMemoryRuntimeFixture(root,{python:'3.13.0'});
    await assert.rejects(verify(),/version\/platform\/layer mismatch/);
    await sealMemoryRuntimeFixture(root,{protocol:{name:'memoweft.dsh_rpc',version:3,schemaVersion:1}});
    await assert.rejects(verify(),/version\/platform\/layer mismatch/);
    await sealMemoryRuntimeFixture(root);await writeFile(join(root,'extra.txt'),'undeclared');
    await assert.rejects(verify(),/hash-mismatched/);await rm(join(root,'extra.txt'));
    await writeFile(join(root,'python/python313._pth'),'python313.zip\n.\nimport site\n');
    await sealMemoryRuntimeFixture(root);await assert.rejects(verify(),/relative Python path mismatch/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('dependency metadata and full-layer DLL/model omissions fail even after resealing inventory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-runtime-layers-'));
  try{
    await memoryRuntimeFixture(root);
    const metadata=join(root,'site-packages/httpx-0.28.1.dist-info/METADATA');
    await writeFile(metadata,'Name: httpx\nVersion: 0.0.0\n');await sealMemoryRuntimeFixture(root);
    await assert.rejects(verifyMemoryRuntime(root,{mode:'base'}),/dependency version/);
    await memoryRuntimeFixture(root);await sealMemoryRuntimeFixture(root,{mode:'full'});
    await assert.rejects(verifyMemoryRuntime(root,{mode:'full'}),/required file missing/);
    await memoryRuntimeFixture(root);await mkdir(join(root,'models'));
    await writeFile(join(root,'models/unexpected.onnx'),'synthetic');await sealMemoryRuntimeFixture(root);
    await assert.rejects(verifyMemoryRuntime(root,{mode:'base'}),/contains semantic layer/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('shared packaging resource retains explicit choice and refuses omitted or wrong payload',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-runtime-pack-'));
  try{
    await memoryRuntimeFixture(root);
    const verify=(source,options)=>verifyMemoryRuntime(source,{mode:options.mode});
    const config=await withMemoryRuntimeResources({extraMetadata:{version:'1.0.0'},extraResources:[{from:'synthetic-vendor',to:'dsh-runtime'}]},{mode:'base',source:root},verify);
    assert.equal(config.extraMetadata.memoryRuntimeMode,'base');assert.equal(config.extraResources.length,2);
    assert.equal(config.extraResources[1].to,'memory-runtime');assert.equal(config.extraResources[1].from,root);
    await assert.rejects(withMemoryRuntimeResources(config,{mode:'full',source:root},verify),/layer mismatch/);
    await rm(join(root,'python/python313.dll'));
    await assert.rejects(withMemoryRuntimeResources(config,{mode:'base',source:root},verify),/hash-mismatched/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('full layer individually requires both app-local DLLs, the model and tokenizer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-runtime-full-missing-'));
  try{
    await memoryRuntimeFixture(root);
    const artifacts=['licenses/E5-MODEL-CARD.md','licenses/VC-LICENSE.rtf',...lock.vc.files.map(d=>'python/'+d.name),...lock.model.files.map(d=>'models/'+d.file)];
    for(const name of artifacts){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),'synthetic fixed-asset substitute');}
    for(const d of lock.dependencies.filter(d=>d.layer==='semantic')){
      const file=join(root,`site-packages/${d.name}-${d.version}.dist-info/METADATA`);
      await mkdir(join(file,'..'),{recursive:true});await writeFile(file,`Name: ${d.name}\nVersion: ${d.version}\n`);
    }
    await sealMemoryRuntimeFixture(root,{mode:'full'});
    await assert.rejects(verifyMemoryRuntime(root,{mode:'full'}),/pinned semantic file mismatch/);
    for(const name of [...lock.vc.files.map(d=>'python/'+d.name),...lock.model.files.map(d=>'models/'+d.file)]){
      await rm(join(root,name));await sealMemoryRuntimeFixture(root,{mode:'full'});
      await assert.rejects(verifyMemoryRuntime(root,{mode:'full'}),error=>error.message===`memory runtime required file missing: ${name}`);
      await writeFile(join(root,name),'synthetic fixed-asset substitute');
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('payload refuses directory links and account database files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'memory-runtime-link-'));
  let linked=false;
  try{
    await memoryRuntimeFixture(root);
    await writeFile(join(root,'account.sqlite3'),'synthetic');
    await assert.rejects(verifyMemoryRuntime(root,{mode:'base'}),/non-distribution file/);
    await rm(join(root,'account.sqlite3'));
    await symlink(join(root,'core'),join(root,'linked-core'),process.platform==='win32'?'junction':'dir');linked=true;
    await assert.rejects(verifyMemoryRuntime(root,{mode:'base'}),/reparse point/);
  }finally{
    if(linked)await rm(join(root,'linked-core'));
    await rm(root,{recursive:true,force:true});
  }
});
