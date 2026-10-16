import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const lockBytes=readFileSync(new URL('./lock.json',import.meta.url));
export const lock=JSON.parse(lockBytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
export const lockDigest=sha(lockBytes);
export const PTH='python313.zip\n.\n../core/src\n../site-packages\n';
export function modeOf(mode){
  if(!['base','full'].includes(mode))throw Error('Windows packaging requires explicit memory runtime mode: base or full');
  return mode;
}
export async function inventory(root){
  const files={};
  async function visit(dir){
    for(const entry of (await readdir(dir)).sort()){
      const file=join(dir,entry),name=relative(root,file).replaceAll('\\','/'),stat=await lstat(file);
      if(stat.isSymbolicLink())throw Error(`memory runtime reparse point: ${name}`);
      if(stat.isDirectory())await visit(file);
      else if(stat.isFile()&&name!=='MEMORY-RUNTIME.json'){
        if(/(?:^|\/)(?:__pycache__|\.git|pip)(?:\/|$)|\.(?:pyc|sqlite3?|db)$/i.test(name))throw Error(`memory runtime contains non-distribution file: ${name}`);
        files[name]={bytes:stat.size,sha256:sha(await readFile(file))};
      }
    }
  }
  if((await lstat(root)).isSymbolicLink())throw Error('memory runtime root is a reparse point');
  await visit(root);return files;
}
export async function verifyMemoryRuntime(root,{mode,probe=false}={}){
  root=resolve(root);mode=modeOf(mode);
  const manifest=JSON.parse(await readFile(join(root,'MEMORY-RUNTIME.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.platform!==lock.platform||manifest.mode!==mode||manifest.python!==lock.python.version||manifest.core!==lock.core.commit||manifest.lockSha256!==lockDigest||JSON.stringify(manifest.protocol)!==JSON.stringify(lock.protocol))throw Error('memory runtime version/platform/layer mismatch');
  if(JSON.stringify(manifest.invocation)!==JSON.stringify({executable:'python/python.exe',args:['-B','-m','memoweft.integrations.dsh_bridge']}))throw Error('memory runtime invocation mismatch');
  if(sha(await readFile(join(root,'runtime-lock.json')))!==lockDigest)throw Error('memory runtime fixed lock mismatch');
  if(await readFile(join(root,'python/python313._pth'),'utf8')!==PTH)throw Error('memory runtime relative Python path mismatch');
  const files=await inventory(root);
  if(JSON.stringify(files)!==JSON.stringify(manifest.files))throw Error('memory runtime missing, extra, or hash-mismatched file');
  const required=['python/python.exe','python/python313.dll','python/python313.zip','python/LICENSE.txt','core/src/memoweft/integrations/dsh_bridge/__main__.py','licenses/MemoWeft-LICENSE','licenses/NOTICE.md'];
  if(mode==='full')required.push('licenses/E5-MODEL-CARD.md','licenses/VC-LICENSE.rtf',...lock.vc.files.map(d=>'python/'+d.name),...lock.model.files.map(d=>'models/'+d.file));
  for(const name of required)if(!files[name])throw Error(`memory runtime required file missing: ${name}`);
  const expected=lock.dependencies.filter(d=>d.layer==='base'||mode==='full');
  const canonical=name=>name.toLowerCase().replaceAll('_','-');
  const metadata=new Map();
  for(const name of Object.keys(files).filter(n=>/^site-packages\/[^/]+\.dist-info\/METADATA$/.test(n))){
    const text=await readFile(join(root,name),'utf8');
    const packageName=/^Name: (.+)$/m.exec(text)?.[1],version=/^Version: (.+)$/m.exec(text)?.[1];
    if(!packageName||metadata.has(canonical(packageName)))throw Error('memory runtime dependency metadata invalid');
    metadata.set(canonical(packageName),version);
  }
  if(metadata.size!==expected.length||expected.some(d=>metadata.get(d.name)!==d.version))throw Error('memory runtime dependency version/layer mismatch');
  if(mode==='base'&&Object.keys(files).some(x=>x.startsWith('models/')||x.startsWith('site-packages/onnxruntime/')))throw Error('base memory runtime contains semantic layer');
  if(mode==='full')for(const d of [...lock.model.files.map(x=>({...x,name:'models/'+x.file})),...lock.vc.files.map(x=>({...x,name:'python/'+x.name}))]){
    if(files[d.name]?.sha256!==d.sha256||files[d.name]?.bytes!==d.bytes)throw Error(`memory runtime pinned semantic file mismatch: ${d.name}`);
  }
  if(mode==='full'&&(files['licenses/VC-LICENSE.rtf'].sha256!==lock.vc.license.sha256||files['licenses/E5-MODEL-CARD.md'].sha256!==lock.model.card.sha256))throw Error('memory runtime pinned license mismatch');
  let check=null;
  if(probe){
    const result=spawnSync(join(root,'python/python.exe'),['-B',resolve(import.meta.dirname,'probe.py'),root,mode],{encoding:'utf8',windowsHide:true,timeout:120000,
      // No inherited Python/Core/model settings, no model credentials. This is
      // isolation on the build host, not proof of a clean Windows machine.
      env:{SystemRoot:process.env.SystemRoot,PATH:join(process.env.SystemRoot||'C:/Windows','System32'),TEMP:process.env.TEMP,TMP:process.env.TMP}});
    if(result.status!==0)throw Error(`memory runtime offline/RPC probe failed: ${result.stderr||result.stdout||result.error}`);
    check=JSON.parse(result.stdout);
  }
  return {mode,platform:lock.platform,python:manifest.python,core:manifest.core,files:Object.keys(files).length,bytes:Object.values(files).reduce((n,f)=>n+f.bytes,0),manifestSha256:sha(await readFile(join(root,'MEMORY-RUNTIME.json'))),probe:check};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const option=name=>process.argv[process.argv.indexOf(name)+1];
  console.log(JSON.stringify(await verifyMemoryRuntime(option('--root'),{mode:option('--mode'),probe:process.argv.includes('--probe')}),null,2));
}
