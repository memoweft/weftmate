// Read-only diagnosis of the exact Windows baseline check failure.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {scan,check} from '../../../../apps/apple/Scripts/check_callback_isolation.mjs';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>['Build','.build','Tests','.git'].includes(e.name)?[]:e.isDirectory()?walk(join(dir,e.name)):e.name.endsWith('.swift')?[join(dir,e.name)]:[]);
const files=walk('apps/apple'),allowed=JSON.parse(readFileSync('apps/apple/Scripts/callback-isolation-allowlist.json','utf8'));
const rows=normalize=>files.flatMap(file=>scan(normalize(readFileSync(file,'utf8')),file.replaceAll('\\','/')));
const raw=check(rows(x=>x),allowed),lf=check(rows(x=>x.replaceAll('\r\n','\n')),allowed);
writeFileSync('tests/evidence/qa-6/apple-line-ending.json',JSON.stringify({rawFailures:raw.length,lfNormalizedInMemoryFailures:lf.length,filesChanged:0,raw:raw.map(({file,line,api})=>({file,line,api}))},null,2));
console.log(JSON.stringify({raw:raw.length,lf:lf.length,filesChanged:0}));
