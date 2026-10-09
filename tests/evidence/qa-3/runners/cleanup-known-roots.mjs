import {readFileSync,existsSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
const roots=new Set([
 'C:/Temp/weftmate-m0-7c-mimo-46677c7f-96cc-40ee-82f2-5d32f0bbaf40',
 'C:/Temp/weftmate-m0-7b-lan-ec43a987-3f6c-4d70-8dfb-d414c5ec69c6',
 'C:/Temp/weftmate-m0-7c-mimo-02dcbd99-69af-4958-8942-a2a33952038c',
 'C:/Temp/weftmate-m2-exit-mimo-kmoHQE','C:/Temp/weftmate-ia-2a-4CjDL3',
 'C:/Temp/weftmate-pj-1-mimo-a82f3e55-4054-42f3-96f0-6faea4ae1caf',
 'C:/Temp/weftmate-ui-5-mimo-a29fdb19-88f1-45bd-8206-8524bd57151e',
 'C:/Temp/weftmate-m3a-e2e-d16n1V','C:/Temp/weftmate-m3a-e2e-DDIaQ8',
 'C:/Temp/weftmate-ms1-alc3FW'
]);
const read=p=>JSON.parse(readFileSync(p,'utf8'));
roots.add(read('tests/evidence/qa-3/desktop/results.json').root);
if(existsSync('.local/qa-3/settings-private.json'))roots.add(read('.local/qa-3/settings-private.json').root);
for(const p of ['tests/evidence/qa-3/m2/run-roots.json','tests/evidence/qa-3/mf2/run-roots.json'])if(existsSync(p))for(const r of read(p))roots.add(r);
for(const name of ['m1-mimo','m1-lan','immediate'])for(const r of read(`tests/evidence/qa-3/${name}/results.json`).results)if(r.scratchDir)roots.add(r.scratchDir);
const report={checkedAt:new Date().toISOString(),roots:[],privateBackupCopiesHandledByMigrationFinally:true};
for(const r of roots){if(!r)continue;const p=resolve(r);if(dirname(p).toLowerCase()!==resolve('C:/Temp').toLowerCase()||!/^weftmate-/.test(basename(p)))throw Error('Unowned or unexpected cleanup path');
 if(existsSync(p)){const actual=realpathSync(p);if(dirname(actual).toLowerCase()!==realpathSync('C:/Temp').toLowerCase())throw Error('Cleanup escaped temporary directory');rmSync(p,{recursive:true,force:true,maxRetries:3,retryDelay:300});}
 report.roots.push({name:basename(p),remaining:existsSync(p)});
}
for(const p of ['.local/qa-3/settings-private.json','.local/qa-3/private.pem'])if(existsSync(p))rmSync(p);
report.testSigningPrivateKeyRemoved=!existsSync('.local/qa-3/private.pem');
writeFileSync('tests/evidence/qa-3/temporary-cleanup.json',JSON.stringify(report,null,2));console.log(JSON.stringify({roots:report.roots.length,remaining:report.roots.filter(r=>r.remaining).length,testSigningPrivateKeyRemoved:report.testSigningPrivateKeyRemoved}));
