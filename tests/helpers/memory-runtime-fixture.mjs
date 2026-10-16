import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inventory,lock,lockDigest,lockText,PTH} from '../../scripts/memory-runtime/verify.mjs';

// File-boundary fixture; actual interpreter/RPC/encoding tests run on the
// assembled upstream payload in the Windows package workflow.
export async function memoryRuntimeFixture(root){
  const files={
    'python/python.exe':'synthetic executable','python/python313.dll':'synthetic DLL',
    'python/python313.zip':'synthetic stdlib','python/LICENSE.txt':'synthetic license',
    'python/python313._pth':PTH,'core/src/memoweft/integrations/dsh_bridge/__main__.py':'# synthetic',
    'licenses/MemoWeft-LICENSE':'synthetic license','licenses/NOTICE.md':'synthetic notice',
  };
  for(const d of lock.dependencies.filter(d=>d.layer==='base'))files[`site-packages/${d.name}-${d.version}.dist-info/METADATA`]=`Name: ${d.name}\nVersion: ${d.version}\n`;
  for(const [name,content] of Object.entries(files)){
    const file=join(root,name);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,content);
  }
  await writeFile(join(root,'runtime-lock.json'),lockText);
  return sealMemoryRuntimeFixture(root);
}
export async function sealMemoryRuntimeFixture(root,changes={}){
  const manifest={schemaVersion:1,platform:lock.platform,mode:'base',lockSha256:lockDigest,
    python:lock.python.version,core:lock.core.commit,protocol:lock.protocol,
    invocation:{executable:'python/python.exe',args:['-B','-m','memoweft.integrations.dsh_bridge']},
    files:await inventory(root),...changes};
  await writeFile(join(root,'MEMORY-RUNTIME.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
