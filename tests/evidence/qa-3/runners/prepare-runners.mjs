import {readFileSync,writeFileSync} from 'node:fs';
const targets = ['ia-2a-identity','m3-a-offline','ux-1-consistency','r0-1-installed','r0-1-rollback','r0-1-migration'];
for(const name of targets){
 let s=readFileSync(`tests/integration/${name}.mjs`,'utf8');
 s=s.replaceAll("from '../../", "from '../../../../").replaceAll("from '../helpers/", "from '../../../../tests/helpers/");
 s=s.replace(/from '\.\/([^']+)'/g,"from '../../../../tests/integration/$1'");
 s=s.replaceAll("import.meta.dirname, '../..'", "import.meta.dirname, '../../../..'").replaceAll("import.meta.dirname,'../..'", "import.meta.dirname,'../../../..'");
 s=s.replaceAll('tests/evidence/ia-2a','tests/evidence/qa-3/ia-2a').replaceAll('tests/evidence/m3-a','tests/evidence/qa-3/offline').replaceAll('tests/evidence/ux-1','tests/evidence/qa-3/ux-1').replaceAll('tests/evidence/r0-1','tests/evidence/qa-3/installed');
 s=s.replaceAll('D:/AIProjects/MemoWeft/Core/py/src', 'D:/AIProjects/WeftMate/Worktrees/w4/.local/qa-3/core/py/src');
 s=s.replaceAll('WeftMate r01qa','WeftMate qa3').replaceAll('.local/r0-1/private.pem','.local/qa-3/private.pem');
 writeFileSync(`tests/evidence/qa-3/runners/${name}.mjs`,s);
}
let relay=readFileSync('tests/evidence/qa-3/runners/relay-task.mjs','utf8').replaceAll('.local/qa-3/relay-', 'tests/evidence/qa-3/runners/relay-');
writeFileSync('tests/evidence/qa-3/runners/relay-task.mjs',relay);
let android=readFileSync('tests/evidence/qa-3/runners/android-extras.mjs','utf8').replace('for(const theme of [])','for(const theme of [\'light\',\'dark\'])').replace(",'系统状态','备份与恢复'",'');
writeFileSync('tests/evidence/qa-3/runners/android-extras.mjs',android);
