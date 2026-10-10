import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { scanStatistics } from '../../src/personal-data/statistics.mjs';
const root=await mkdtemp(join(tmpdir(),'weftmate-st4-50k-')),out=resolve('tests/evidence/st-4');await mkdir(out,{recursive:true});
try {
 const fileCount=50000,bytes=2*1024**3,small=Math.floor(bytes/fileCount),extra=bytes-small*fileCount;
 const block=Buffer.alloc(small,0x53);let created=0;
 for(let directory=0;directory<100;directory++) {const dir=join(root,String(directory));await mkdir(dir);for(let offset=0;offset<500;offset++){await writeFile(join(dir,String(offset)),created++===0?Buffer.alloc(small+extra,0x53):block);} }
 const delay=monitorEventLoopDelay({resolution:10});delay.enable();const start=performance.now();let ticks=0;const timer=setInterval(()=>ticks++,10);
 const result=await scanStatistics([{path:root,category:'conversations'}]);clearInterval(timer);delay.disable();
 assert.equal(result.conversations.bytes,bytes);assert.equal(result.conversations.files,fileCount);assert.ok(ticks>10);
 const report={bytes,fileCount,durationMs:Math.round(performance.now()-start),eventLoopP99Ms:Math.round(delay.percentile(99)/1e6),parentTimerTicks:ticks,sparse:false,randomPortNotNeeded:true};
 await writeFile(join(out,'statistics-benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await rm(root,{recursive:true,force:true});}
