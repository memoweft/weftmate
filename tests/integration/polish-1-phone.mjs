/** Full Android browser screens from synthetic mobile assets, before and after. */
process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {capturePolishPhone} from '../helpers/polish-1-phone.mjs';
import {statisticalInsight} from '../../src/personal-access/daily-digest.mjs';
const out=resolve('tests/evidence/polish-1');await mkdir(out,{recursive:true});
const days=Array.from({length:7},(_,i)=>({day:`2026-10-${String(5+i).padStart(2,'0')}`,tasks:{completed:1,items:[]},outputs:{count:0,items:[]},usage:{hourlyTurns:[0,1,0,0,0,0]},conversations:{items:[]}}));
for(const phase of ['before','after']){
 const fixture=await startTimelineCandidate({interactive:true,historyCount:0,composer:true,inlineProgress:true});fixture.progress.text('报告已完成，相关测试通过。');fixture.progress.finish();
 const insight=statisticalInsight(days);if(phase==='before')insight.text=insight.text.replace('这周每天','周一、周二、周三、周四、周五、周六、周日');
 const weekly={items:[{id:'synthetic-week',type:'memory.report',title:'这周回顾',summary:'完成 7 件事',at:new Date().toISOString(),source:{usageWeek:'2026-10-12'},weeklyInsight:{from:'2026-10-05',to:'2026-10-12',text:insight.text,sources:[],mode:'statistics'},actions:[],state:'completed',read:false}],timeZone:'Asia/Shanghai',unreadCount:1,actionableCount:0,nextCursor:null};
 const report={syntheticOnly:true,realModelRequests:0,screenshots:[],checks:[]};
 try{await capturePolishPhone(fixture,out,report,phase,weekly);await writeFile(join(out,`phone-verification-${phase}.json`),JSON.stringify(report,null,2)+'\n');}
 finally{await fixture.close();await rm(fixture.root,{recursive:true,force:true});}
}
