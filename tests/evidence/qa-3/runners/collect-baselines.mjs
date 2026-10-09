import {mkdirSync,copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const batches={
 'm1-mimo':'C:/Temp/weftmate-m0-7c-mimo-46677c7f-96cc-40ee-82f2-5d32f0bbaf40',
 'm1-lan':'C:/Temp/weftmate-m0-7b-lan-ec43a987-3f6c-4d70-8dfb-d414c5ec69c6',
 'immediate':'C:/Temp/weftmate-m0-7c-mimo-02dcbd99-69af-4958-8942-a2a33952038c'
};
for(const [name,root] of Object.entries(batches)){
 const dest='tests/evidence/qa-3/'+name;mkdirSync(dest,{recursive:true});
 for(const [src,out] of [['eval/results.json','results.json'],['requests.jsonl','requests.jsonl'],['lan-serial-requests.json','lan-serial.json'],['credential-scan.json','credential-scan.json']])if(existsSync(join(root,src)))copyFileSync(join(root,src),join(dest,out));
}
copyFileSync('C:/Temp/weftmate-eval-action-02-web-document-Pci8p6/node24说明.md','tests/evidence/qa-3/m1-mimo/node24说明.md');
writeFileSync('tests/evidence/qa-3/revisions.json',JSON.stringify({windows:'1bbc863aa664d58105c0f1b086c5f8dc702c9235',core:'a9b115f2d0de10bdf79bd7000057da6cbda7c046',coreSource:'read-only git archive; no Core working tree modification',stressConcurrentLoad:'M1/M2/UI/installer builds overlapped; report is not an isolated CPU benchmark'},null,2));
// Fix a copied runner's screenshot directory label; pixels and results are unchanged.
const settings='tests/evidence/qa-3/settings/results.json';writeFileSync(settings,readFileSync(settings,'utf8').replaceAll('"desktop/','"settings/'));
