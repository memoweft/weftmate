import { evidencePath } from '../helpers/evidence-path.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProcessEvidence } from '../helpers/process-evidence.mjs';
const repo=resolve(import.meta.dirname,'../..'), electron=createRequire(import.meta.url)('electron');
const root=mkdtempSync('C:/weftmate-rob1-'), startedAt=Date.now();
const phase=process.argv[2] || 'before-fix', report=[], output=resolve(process.env.WEFTMATE_ROB1_MATRIX_OUTPUT || evidencePath('rob-1'));
mkdirSync(output,{recursive:true});
const moduleFile=resolve(process.argv[3] || 'src/config-store.ts');
let cleaned=0, safeToRemove=true;
async function run(profile,action,timing,sourceModule=moduleFile) {
  const evidence=createProcessEvidence({outputDir:join(repo,'.local/rob-1-processes',phase,profile.split(/[\\/]/).at(-1),action+'-'+timing),profileDirectory:profile,commandRoots:[root],executables:[electron],startedAt});
  const env={...process.env}; for(const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)/.test(key)) delete env[key];
  const {child,done}=evidence.spawn(electron,[join(repo,'tests/helpers/rob-1-vault-electron.cjs'),profile,action,timing,sourceModule],{cwd:repo,env});
  let buffer='', killed=false;
  child.stdout.on('data',chunk=>{ buffer+=chunk; if(action==='kill' && buffer.includes('"stage":"'+timing+'"') && !killed) { killed=true; child.kill('SIGKILL'); } });
  const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
  try { const result=await done; const stages=buffer.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    if(result.decimal===74)console.error('ROB-1 fixture failure:',JSON.stringify({...result,stages}));
    return {exit:result.hexadecimal, stages, ...(result.decimal===74?{failure:result}: {})}; }
  finally {clearTimeout(timer);const c=await evidence.finalize();cleaned+=c.cleaned;safeToRemove&&=!c.stillRunning&&!c.preservationError;assert.equal(c.stillRunning,false);}
}
try {
  if(phase==='after-fix') {
    const profile=join(root,'readiness-race');mkdirSync(profile);
    const readiness=await run(profile,'readiness-race','none');
    assert.equal(readiness.exit,'0x00000000',JSON.stringify(readiness));
    assert.equal(readiness.stages.find(row=>row.stage==='readiness-race')?.readable,true);
    console.log('readiness-race: readable=true');
  }
  for(const established of (phase==='after-fix'?[false,true,'legacy-upgrade']:[false,true])) for(const action of ['crash','kill','power-cut']) for(const timing of ['before','during','after']) {
    const category=typeof established==='string'?established:established?'existing':'new';
    const profile=join(root,`${category}-${action}-${timing}`);mkdirSync(profile);
    if(established) assert.equal((await run(profile,'normal','none',established==='legacy-upgrade'?join(repo,'tests/helpers/rob-1-legacy-vault.mjs'):moduleFile)).exit,'0x00000000');
    const interrupted=await run(profile,action,timing), restart=await run(profile,'read','none');
    const read=restart.stages.find(row=>row.stage==='read'); assert.ok(read, 'restart must reach read checkpoint');
    const committed=existsSync(join(profile,'weftmate-model.enc'));
    report.push({established,action,timing,interrupted,restart,committed,readable:read.readable,revision:read.revision});
    console.log(`${phase} ${category} ${action}/${timing}: committed=${committed} readable=${read.readable}`);
    if(phase==='after-fix') assert.ok(!committed || read.readable,'committed credentials must be readable after interruption');
    if(phase==='after-fix' && (established || timing==='after')) assert.equal(read.revision,timing==='after'?'new':'old','an interrupted replacement keeps the old complete value or the newly committed complete value');
    if(phase==='after-fix' && committed && timing==='after') {
      const previousVersion=await run(profile,'read','none',join(repo,'tests/helpers/rob-1-legacy-vault.mjs'));
      assert.equal(previousVersion.stages.find(row=>row.stage==='read')?.readable,true,'previous binaries must still read the updated raw safeStorage vault');
      report.at(-1).previousVersion=previousVersion;
      const original=readFileSync(join(profile,'weftmate-model.enc'));
      rmSync(join(profile,'Local State'),{force:true});
      const lostStateRestart=await run(profile,'read','none');
      assert.equal(lostStateRestart.stages.find(row=>row.stage==='read')?.readable,false,'deleted Chromium master is not reconstructed by product code');
      assert.deepEqual(readFileSync(join(profile,'weftmate-model.enc')),original,'unreadable original stays in place');
      assert.equal(readdirSync(profile).some(name=>name.includes('.unreadable-')||name.includes('.recovery.')),false);
      report.at(-1).lostStateRestart=lostStateRestart;
      assert.equal((await run(profile,'refill','none')).exit,'0x00000000');
      assert.equal((await run(profile,'read','none')).stages.find(row=>row.stage==='read')?.readable,true);
      const replaced=readdirSync(profile).filter(name=>name.startsWith('weftmate-model.enc.replaced-'));
      assert.equal(replaced.length,1); assert.deepEqual(readFileSync(join(profile,replaced[0])),original);
      report.at(-1).lostStateOriginalRetained=true; report.at(-1).explicitRefillReadable=true;

    }
  }
} finally {
  writeFileSync(join(output,phase+'-matrix.json'),JSON.stringify({phase,electronVersion:createRequire(import.meta.url)('electron/package.json').version,modelRequests:0,rows:report,cleaned},null,2)+'\n');
  // Every process finalized above; only this explicitly created synthetic root.
  if(safeToRemove)rmSync(root,{recursive:true,force:true});console.log(`已清理进程：${cleaned}`);
}
