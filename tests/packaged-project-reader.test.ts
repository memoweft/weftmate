import test from 'node:test';
import assert from 'node:assert/strict';
import {createPackage} from '@electron/asar';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {_electron} from 'playwright';

test('bundled project reader runs from a real ASAR without extracting an executable script', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'weftmate-fx21-asar-')),source=join(root,'source'),project=join(root,'project');
  mkdirSync(source);mkdirSync(project);writeFileSync(join(project,'brief.md'),'FX21 synthetic project');
  copyFileSync('src/personal-projects/reader.ps1',join(source,'reader.ps1'));
  if(process.env.FX21_BASELINE==='1')writeFileSync(join(source,'index.mjs'),execFileSync('git',['show','086f52d4:src/personal-projects/index.mjs']));
  else copyFileSync('src/personal-projects/index.mjs',join(source,'index.mjs'));
  try {
    await createPackage(source,join(root,'app.asar'));
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('tests/integration/packaged-reader-bootstrap.mjs')],env,timeout:20000});
    try {
      const text=await app.evaluate(async (_,input)=>(globalThis as any).packagedReader(input),{module:join(root,'app.asar','index.mjs'),project});
      assert.equal(text,'FX21 synthetic project');
    }finally{await app.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
