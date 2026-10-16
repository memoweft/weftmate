/** Build-time assembly only. Inputs are fixed archives; the user never runs pip. */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {copyFile,cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inventory,lock,lockDigest,lockText,modeOf,verifyMemoryRuntime,PTH} from './verify.mjs';
import {assertUnlinkedPath,createRuntimeScratch} from '../dsh-runtime-storage.mjs';

const repository=resolve(import.meta.dirname,'../..');
const digest=b=>createHash('sha256').update(b).digest('hex');
function run(command,args){
  const r=spawnSync(command,args,{cwd:repository,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  if(r.status!==0)throw Error(`memory runtime build command failed: ${command}: ${r.stderr||r.stdout||r.error}`);
  return r.stdout.trim();
}
export function checkInput(bytes,input){
  if(digest(bytes)!==input.sha256 || (input.bytes && bytes.length!==input.bytes))throw Error(`memory runtime input hash/size mismatch: ${input.file}`);
}
export async function prepareMemoryRuntime({mode,output,cache,coreCheckout,offline=false}){
  mode=modeOf(mode);
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('memory runtime assembly requires Windows x64');
  output=resolve(output);cache=resolve(cache);coreCheckout=resolve(coreCheckout);
  await assertUnlinkedPath(output);await assertUnlinkedPath(cache);
  if(existsSync(output)&&(await readdir(output)).length)throw Error('memory runtime output must be empty');
  await mkdir(output,{recursive:true});await mkdir(cache,{recursive:true});
  const scratch=await createRuntimeScratch(cache);
  try {
  const seven=join(repository,'node_modules/electron-winstaller/vendor/7z-x64.exe');
  const extract=(file,to)=>{run(seven,['x','-y',`-o${to}`,file]);};
  const input=async item=>{
    const file=join(cache,item.file);
    if(!existsSync(file)){
      if(offline)throw Error(`offline memory runtime input missing: ${item.file}`);
      const r=await fetch(item.url);
      if(!r.ok)throw Error(`memory runtime input download failed: ${item.file}: ${r.status}`);
      const bytes=Buffer.from(await r.arrayBuffer());checkInput(bytes,item);await writeFile(file,bytes);
    }
    checkInput(readFileSync(file),item);return file;
  };
  const tree=run('git',['-C',coreCheckout,'rev-parse',`${lock.core.commit}:py/src`]);
  if(tree!==lock.core.sourceTree)throw Error('memory runtime Core tree mismatch');
  const coreLock=spawnSync('git',['-C',coreCheckout,'show',`${lock.core.commit}:py/uv.lock`],{windowsHide:true});
  if(coreLock.status!==0||digest(coreLock.stdout)!==lock.core.lockSha256)throw Error('memory runtime Core dependency lock mismatch');
  // Export Git objects, never the checkout's untracked files or working edits.
  const archive=join(scratch.root,'core.zip');
  run('git',['-C',coreCheckout,'archive','--format=zip',`--output=${archive}`,lock.core.commit,'py/src','py/LICENSE','py/pyproject.toml','py/uv.lock']);
  const source=join(scratch.root,'source');
  extract(archive,source);
  await cp(join(source,'py/src'),join(output,'core/src'),{recursive:true});
  await copyFile(join(source,'py/pyproject.toml'),join(output,'core/pyproject.toml'));
  await mkdir(join(output,'licenses'),{recursive:true});
  await copyFile(join(source,'py/LICENSE'),join(output,'licenses/MemoWeft-LICENSE'));
  extract(await input(lock.python),join(output,'python'));
  await writeFile(join(output,'python/python313._pth'),PTH);
  const dependencies=lock.dependencies.filter(d=>d.layer==='base'||mode==='full');
  for(const d of dependencies)extract(await input(d),join(output,'site-packages'));
  if(mode==='full'){
    await copyFile(await input(lock.model.card),join(output,'licenses/E5-MODEL-CARD.md'));
    await mkdir(join(output,'models'),{recursive:true});
    for(const model of lock.model.files){
      const item={...model,url:`https://huggingface.co/${lock.model.id}/resolve/${lock.model.revision}/onnx/${model.file}`};
      await copyFile(await input(item),join(output,'models',model.file));
    }
    const redist=await input(lock.vc),bytes=readFileSync(redist),container=join(scratch.root,'vc-attached.cab');
    await writeFile(container,bytes.subarray(lock.vc.container.offset,lock.vc.container.offset+lock.vc.container.bytes));
    const vc=join(scratch.root,'vc-extracted'),crt=join(scratch.root,'vc-crt'),license=join(scratch.root,'vc-license');
    extract(container,vc);extract(join(vc,lock.vc.container.entry),crt);extract(redist,license);
    for(const item of lock.vc.files){
      const source=join(crt,item.name+'_amd64');checkInput(readFileSync(source),{...item,file:item.name});
      await copyFile(source,join(output,'python',item.name));
    }
    const terms=join(license,lock.vc.license.entry);
    checkInput(readFileSync(terms),{...lock.vc.license,file:'VC-LICENSE.rtf'});
    await copyFile(terms,join(output,'licenses/VC-LICENSE.rtf'));
  }
  // Keep upstream wheel license notices and metadata intact. No pip, caches,
  // build machine paths, account database, or generated bytecode enter output.
  await copyFile(join(repository,'scripts/memory-runtime/NOTICE.md'),join(output,'licenses/NOTICE.md'));
  await writeFile(join(output,'runtime-lock.json'),lockText);
  const manifest={schemaVersion:1,platform:lock.platform,mode,lockSha256:lockDigest,
    python:lock.python.version,core:lock.core.commit,protocol:lock.protocol,
    invocation:{executable:'python/python.exe',args:['-B','-m','memoweft.integrations.dsh_bridge']},
    files:await inventory(output)};
  await writeFile(join(output,'MEMORY-RUNTIME.json'),JSON.stringify(manifest,null,2)+'\n');
  return await verifyMemoryRuntime(output,{mode,probe:true});
  } finally {await scratch.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  console.log(JSON.stringify(await prepareMemoryRuntime({mode:option('--mode'),output:option('--output'),cache:option('--cache'),coreCheckout:option('--core-checkout'),offline:process.argv.includes('--offline')}),null,2));
}
