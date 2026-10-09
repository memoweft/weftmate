import {openSync,writeFileSync,closeSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock',token='QA-3 M1 '+new Date().toISOString();
const fd=openSync(lock,'wx');writeFileSync(fd,token);closeSync(fd);
try {const result=spawnSync(process.execPath,['tests/evidence/qa-3/runners/m1.mjs','--lan','--memory-core-source','.local/qa-3/core/py/src','--only','action-01-organize,action-03-read-code,action-05-stop-resume'],{stdio:'inherit',windowsHide:true,timeout:45*60*1000});process.exitCode=result.status??1;}
finally{if(readFileSync(lock,'utf8')===token)rmSync(lock);}
