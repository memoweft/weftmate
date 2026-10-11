import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createProcessEvidence} from '../../tests/helpers/process-evidence.mjs';
import {snapshot} from '../../src/personal-backup/archive.mjs';
import {beginRestore,commitRestore} from '../../src/personal-backup/restore.mjs';
const electron=createRequire(import.meta.url)('electron');
const root=mkdtempSync(join(tmpdir(),'weftmate-rev-rob1-')),out=resolve('.local/rob-1-review-fixed');
const startedAt=Date.now(),report=[];let cleaned=0,safe=true;
mkdirSync(out,{recursive:true});
const base=resolve('tests/helpers/rob-1-legacy-vault.mjs'),head=resolve('src/config-store.ts');
async function run(profile,action,source=head){
 const evidence=createProcessEvidence({outputDir:join(out,'confirm-processes',String(report.length)),profileDirectory:profile,commandRoots:[root],executables:[electron],startedAt});
 const env={...process.env};for(const k of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(k))delete env[k];
 const {child,done}=evidence.spawn(electron,[resolve('tests/helpers/rob-1-review-probe.cjs'),profile,action,source],{cwd:process.cwd(),env});let buffer='';child.stdout.on('data',b=>buffer+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
 try{const exit=await done;const rows=buffer.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}});const row={exit:exit.decimal,...rows.at(-1)};report.push(row);console.log(JSON.stringify(row));return row;}
 finally{clearTimeout(timer);const c=await evidence.finalize();cleaned+=c.cleaned;safe&&=!c.stillRunning&&!c.preservationError;}
}
try{
 for(let repeat=0;repeat<1;repeat++){
  const old=join(root,'old-'+repeat),fresh=join(root,'fresh-'+repeat);mkdirSync(old);mkdirSync(fresh);
  await run(old,'seed');const oldRecovery=Buffer.from(JSON.stringify({version:1,wrappedKey:JSON.parse(readFileSync(join(old,'Local State'))).os_crypt.encrypted_key}));
  assert.equal(existsSync(join(old,'weftmate-storage-key.json')),false);
  writeFileSync(join(old,'weftmate-storage-key.json'),oldRecovery);
  await run(fresh,'seed',base);await run(fresh,'raw-read',base);
  const correctState=readFileSync(join(fresh,'Local State'));const correctKey=JSON.parse(correctState).os_crypt.encrypted_key;
  // Partial backup restore: old recovery file paired with newer, matching state+ciphertext.
  if(repeat===0){
   const directory=join(root,'backups'),control=join(root,'restore-control');
   const backup=await snapshot({root:old,directory});
   const backupFile=join(directory,backup.id), raw=gunzipSync(readFileSync(backupFile));
   const end=raw.indexOf(10,raw.indexOf(10)+1); const manifest=JSON.parse(raw.subarray(raw.indexOf(10)+1,end));
   assert.ok(!manifest.files.some(f=>f.path.startsWith('weftmate-storage-key.json')));
   manifest.files.push({path:'weftmate-storage-key.json',size:oldRecovery.length,sha256:createHash('sha256').update(oldRecovery).digest('hex')});
   const header=JSON.stringify(manifest); writeFileSync(backupFile,gzipSync(Buffer.concat([Buffer.from('WMB1 '+createHash('sha256').update(header).digest('hex')+'\n'+header+'\n'),raw.subarray(end+1),oldRecovery])));
   await beginRestore({root:fresh,control,file:join(directory,backup.id)});
   await commitRestore({root:fresh,control});
   report.push({scenario:'real-backup-restore',matchingLocalStateRetained:readFileSync(join(fresh,'Local State')).equals(correctState),recoveryRestored:existsSync(join(fresh,'weftmate-storage-key.json'))});
   assert.equal(report.at(-1).matchingLocalStateRetained,true);assert.equal(report.at(-1).recoveryRestored,false);
   console.log(JSON.stringify(report.at(-1)));
  }else writeFileSync(join(fresh,'weftmate-storage-key.json'),oldRecovery);
  const conflict=await run(fresh,'read'); assert.equal(conflict.readable,true); assert.equal(conflict.localStateRetained,true); assert.equal(conflict.ciphertextRetained,true);
  // Also prove startup ignores a stale recovery file already on this machine.
  writeFileSync(join(fresh,'weftmate-storage-key.json'),oldRecovery);
  assert.equal((await run(fresh,'read')).readable,true);
  report.push({scenario:'stale-recovery',repeat,correctMasterOverwritten:JSON.parse(readFileSync(join(fresh,'Local State'))).os_crypt.encrypted_key!==correctKey,originalStateBackup:readdirSync(fresh).some(n=>n.startsWith('Local State.'))});
  assert.equal(report.at(-1).correctMasterOverwritten,false);
  console.log(JSON.stringify(report.at(-1)));
  for(const action of ['transient','unavailable']){
   const p=join(root,action+'-'+repeat);mkdirSync(p);await run(p,'seed',base);const fault=await run(p,action), restart=await run(p,'read');
   for(const row of [fault,restart]) {assert.equal(row.readable,true); assert.equal(row.localStateRetained,true); assert.equal(row.ciphertextRetained,true); assert.equal(row.archived,0); assert.equal(row.recovery,false);}
  }
 }
 const refillProfile=join(root,'explicit-refill');mkdirSync(refillProfile);await run(refillProfile,'seed',base);
 writeFileSync(join(refillProfile,'weftmate-model.enc'),Buffer.from('synthetic unreadable vault'));
 const refill=await run(refillProfile,'refill-check');assert.equal(refill.exit,0);assert.equal(refill.readable,true);
 let hits=0;function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())scan(p);else if(readFileSync(p).includes(Buffer.from('synthetic-review-preserve-me')))hits++;}}scan(root);
 report.push({plaintextHits:hits});
}finally{
 writeFileSync(join(out,'confirm.json'),JSON.stringify({report,cleaned,safe},null,2));
 if(safe&&root.startsWith(join(tmpdir(),'weftmate-rev-rob1-')))rmSync(root,{recursive:true,force:true});
}