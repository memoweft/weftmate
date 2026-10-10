import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const target=process.argv[2]||'smoke';const evidence='tests/evidence/qa-6/'+target;const root=readFileSync(evidence+'/run-root.txt','utf8').trim();
const port=readFileSync(join(root,'profile/DevToolsActivePort'),'utf8').split('\n')[0];
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
const page=browser.contexts()[0].pages().find(p=>p.url().includes('/personal/v1/ui'));
const result=await page.evaluate(async()=>{
 const output={text:document.body.innerText,requests:performance.getEntriesByType('resource').filter(r=>r.name.includes('/suggestions')).map(r=>({path:new URL(r.name).pathname,duration:r.duration}))};
 for(const path of ['/memory/status','/sessions?limit=100','/projects','/commands?limit=5']){try{const r=await fetch('/personal/v1'+path);output[path]={status:r.status,body:await r.json()};}catch(e){output[path]={error:e.message};}}
 return output;
});
writeFileSync(evidence+'/inspect.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({text:result.text,commands:result['/commands?limit=5'],projects:result['/projects']}));
await browser.close();
