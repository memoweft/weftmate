// Cleanup of the synthetic approval left pending by the reload selector failure.
import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=readFileSync('tests/evidence/qa-6/smoke/run-root.txt','utf8').trim(),port=readFileSync(join(root,'profile/DevToolsActivePort'),'utf8').split('\n')[0];
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port),page=browser.contexts()[0].pages().find(p=>p.url().includes('/personal/v1/ui'));
const report=await page.evaluate(async()=>{
 const me=await(await fetch('/personal/v1/auth/me')).json(),status=await(await fetch('/personal/v1/status')).json(),before=await(await fetch('/personal/v1/memory/status')).json();
 const rows=(await(await fetch('/personal/v1/sessions?limit=100')).json()).sessions,results=[];
 for(const row of rows.filter(x=>x.running&&x.attention==='approval')){const r=await fetch('/personal/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID(),kind:'session.cancel',targetDeviceId:status.hostId,sessionId:row.sessionId})});results.push({sessionId:row.sessionId,httpStatus:r.status,command:await r.json()});}
 return {at:new Date().toISOString(),reason:'QA6 fixture reload did not reselect its pending side chat; cancel only that synthetic task',before,results};
});
writeFileSync('tests/evidence/qa-6/smoke/drain-abandoned-approval.json',JSON.stringify(report,null,2));console.log(JSON.stringify({before:report.before,commands:report.results.length}));await browser.close();
