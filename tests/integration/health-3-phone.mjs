process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {captureHealthPhone} from '../helpers/health-page-phone.mjs';
const out=resolve('tests/evidence/health-3');await mkdir(out,{recursive:true});
const fixture=await startTimelineCandidate({logicalMobile:true,interactive:true,historyCount:0,goals:true});
const report={syntheticOnly:true,realModelRequests:0,screenshots:[],checks:[]};
try{await captureHealthPhone(fixture,out,report);await writeFile(join(out,'phone-verification.json'),JSON.stringify(report,null,2)+'\n');}
finally{await fixture.close();await rm(fixture.root,{recursive:true,force:true});}
