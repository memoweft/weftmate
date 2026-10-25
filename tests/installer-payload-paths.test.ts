import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import paths from '../scripts/release/installer-payload-paths.cjs';

test('installer budget includes real file names, directory reserve and UTF-16 names',async()=>{
  const root=await mkdtemp(join(tmpdir(),'installer-paths-'));
  try {
    const relative='resources\\'+('x'.repeat(80))+'😀';
    const dir=join(root,...relative.split('\\'));
    await mkdir(dir,{recursive:true});await writeFile(join(dir,'a.js'),'payload');
    const audit=await paths.installerPayloadPaths(root);
    assert.equal(audit.maxSuffix,relative.length+1+12);
    assert.equal(audit.files,1);assert.equal(audit.directories,2);
    const out=await mkdtemp(join(tmpdir(),'installer-header-'));
    try {
      await paths.writeInstallerPayloadHeader(root,out);
      assert.equal(JSON.parse(await readFile(join(out,'payload-paths.json'),'utf8')).maxSuffix,audit.maxSuffix);
    } finally {await rm(out,{recursive:true,force:true});}
    await writeFile(join(dir,'b'.repeat(70)), 'longer file');
    assert.equal((await paths.installerPayloadPaths(root)).maxSuffix,relative.length+1+1+70);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('installer audit rejects empty and linked payloads',async()=>{
  const root=await mkdtemp(join(tmpdir(),'installer-paths-'));
  const other=await mkdtemp(join(tmpdir(),'installer-link-'));
  try {
    await assert.rejects(paths.installerPayloadPaths(root),/empty/);
    await symlink(other,join(root,'link'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(paths.installerPayloadPaths(root),/physical/);
    await rm(join(root,'link'));
  } finally {await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});

test('installer path budget includes the versioned runtime sibling',async()=>{
  const root=await mkdtemp(join(tmpdir(),'installer-component-paths-'));
  try {
    const app=join(root,'app');await mkdir(app);await writeFile(join(app,'shell.exe'),'shell');
    const relative='dsh\\0123456789abcdef\\node_modules\\'+('x'.repeat(90));
    const directory=join(app+'.components',...relative.split('\\'));
    await mkdir(directory,{recursive:true});await writeFile(join(directory,'entry.js'),'runtime');
    const audit=await paths.installerPayloadPaths(app);
    assert.equal(audit.maxSuffix,'.components'.length+1+relative.length+12);
  } finally {await rm(root,{recursive:true,force:true});}
});
