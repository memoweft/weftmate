import assert from 'node:assert/strict';
import {writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {harness,pause,until} from './harness.mjs';
const baseline=process.argv.includes('--baseline');
const formationOnly=process.argv.includes('--formation-only');
const methodOnly=process.env.QA5_EXIT_METHOD;
const h=await harness(process.env.FX18_RUN || (baseline?'baseline':methodOnly?'exit-formation-'+methodOnly:formationOnly?'exit-formation-final':'exit-matrix')),report={startedAt:new Date().toISOString(),realElectron:true,realCore:true,syntheticModel:true,rows:[]};
const save=()=>writeFileSync(join(h.out,'results.json'),JSON.stringify(report,null,2));
const tmpFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:e.isDirectory()?tmpFiles(join(dir,e.name)):e.name.endsWith('.tmp')?[join(dir,e.name).slice(h.root.length)]:[]);
const owned=()=>{const script="$r=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.CreationDate -gt [datetime]$env:QA5_SINCE -and $_.CommandLine -like ('*'+$env:QA5_ROOT+'*') -and $_.Name -match '^(electron|node|python)\\.exe$' }; @($r | Select-Object ProcessId,Name,CreationDate) | ConvertTo-Json -Compress";const raw=execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,QA5_ROOT:h.root,QA5_SINCE:report.startedAt}}).trim();return raw?JSON.parse(raw):[];};
const cleanup=()=>{const script="$r=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.CreationDate -gt [datetime]$env:QA5_SINCE -and $_.CommandLine -like ('*'+$env:QA5_ROOT+'*') -and $_.Name -match '^(electron|node|python)\\.exe$' }); $r | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; @($r | Select-Object ProcessId,Name,CreationDate) | ConvertTo-Json -Compress";const raw=execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,QA5_ROOT:h.root,QA5_SINCE:report.startedAt}}).trim();return raw?JSON.parse(raw):[];};
try{
 for(const state of baseline?['formation']:formationOnly?['formation']:['idle','chat','formation'])for(const method of baseline?['task-manager-force']:methodOnly?[methodOnly]:['tray','task-manager-force','logout-taskkill'])for(let attempt=1;attempt<=(baseline?1:3);attempt++){
  const row={state,method,attempt,startedAt:new Date().toISOString()};report.rows.push(row);save();
  try{
   h.chatDelay=0;h.formationDelay=0;
   const id=await h.session(),completed=`我偏好第${report.rows.length}种合成茶用白色杯子。`;
   await h.send(id,completed);await h.healthy();
   let completedBefore=(await h.events(id)).filter(e=>['user.message','assistant.message','turn.ended'].includes(e.type));
   row.completedEventCount=completedBefore.length;row.completedEvents=completedBefore;row.sessionId=id;
   if(state==='chat'){h.chatDelay=15000;await h.send(id,'请确认这条正在输出的合成消息。',false);await until(async()=>h.chatActive>0&&(await h.events(id)).some(e=>e.type==='user.message'&&JSON.stringify(e.data).includes('请确认这条正在输出的合成消息。')));row.lastUserAcceptedBeforeExit=true;}
   if(state==='formation'){h.formationDelay=15000;await h.send(id,`我偏好第${report.rows.length}种合成茶加两片柠檬。`);await until(()=>h.formationActive>0);row.pendingBefore=(await h.api('/memory/status')).body;completedBefore=(await h.events(id)).filter(e=>['user.message','assistant.message','turn.ended'].includes(e.type));row.completedEvents=completedBefore;row.completedEventCount=completedBefore.length;}
   const pid=await h.app.evaluate(()=>process.pid),child=h.app.process();
   row.mainPid=pid;row.launcherPid=child.pid;
   save();
   if(method==='tray'){
    await h.app.evaluate(async()=>{for(let i=0;i<50&&!globalThis.qa5Tray;i++)await new Promise(r=>setTimeout(r,100));const exit=globalThis.qa5Tray?.items.find(i=>i.label==='退出');if(!exit)throw Error('tray callback missing');setTimeout(()=>exit.click(),0);});
   }else{
    const kill=args=>{try{execFileSync('taskkill.exe',args,{windowsHide:true,stdio:'pipe'});return true;}catch{return false;}};
    if(method==='logout-taskkill'){row.nonForceAccepted=kill(['/PID',String(pid)]);await pause(1200);}
    row.forceAccepted=kill(['/PID',String(pid),'/F']);
   }
   await until(()=>child.exitCode!==null||child.signalCode!==null,45000);h.app=null;
   h.chatDelay=0;h.formationDelay=0;await pause(2000);
   row.residualProcesses=owned();row.tmpAfterExit=tmpFiles(h.profile);
   save();
   row.restartAt=new Date().toISOString(); const requestOffset=h.requests.length;
   await h.launch();
   row.credentialsRestoredAt=h.credentialsRestoredAt;
   const trace=readFileSync(join(h.root,'trace.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));row.coreStartedAt=trace.find(e=>e.kind==='core-process'&&e.at>=row.restartAt)?.at??null;
   const after=await h.events(id);row.completedRetained=completedBefore.every(e=>after.some(a=>a.type===e.type&&a.seq===e.seq&&JSON.stringify(a.data)===JSON.stringify(e.data)));
   row.healthImmediatelyAfterRestart=(await h.api('/memory/status')).body;const recoveryStart=Date.now();save();if(baseline){await pause(1200);row.healthAfterObservation=(await h.api('/memory/status')).body;row.newFormationCalls=h.requests.slice(requestOffset).filter(r=>r.formation).length;row.passed=row.healthAfterObservation.pendingFormationCount>0&&row.newFormationCalls===0;save();break;}row.health=await h.healthy(30000);row.healthRecoveryMs=Date.now()-recoveryStart;row.restartToHealthyMs=Date.now()-Date.parse(row.restartAt);
   row.restartToProcessingMs=state==='formation'?Date.parse(h.requests.slice(requestOffset).find(r=>r.formation)?.at)-Date.parse(row.restartAt):null;
   row.jobs=await h.app.evaluate(async()=>{const rpc=[...globalThis.m2ExitRpcs].find(r=>r.child);return rpc.request('query_jobs',{operation:'list'});});row.sessionRetained=(await h.api('/sessions')).body.sessions.some(s=>s.sessionId===id);row.tmpAfterRecovery=tmpFiles(h.profile);
   row.passed=(state!=='formation'||row.restartToProcessingMs<10000&&row.restartToHealthyMs<30000)&&row.completedRetained&&row.sessionRetained&&row.health.pendingBoundaryCount===0&&row.tmpAfterRecovery.length===0&&row.residualProcesses.length===0;
   await h.page.screenshot({path:join(h.out,`${state}-${method}-${attempt}.png`)});
  }catch(e){row.error=e.stack;row.passed=false;await h.app?.close().catch(()=>{});h.app=null;row.assistedCleanup=cleanup();await pause(1000);h.chatDelay=0;h.formationDelay=0;await h.launch();if(row.sessionId){const events=await h.events(row.sessionId);row.completedRetainedAfterAssistedCleanup=row.completedEvents.every(e=>events.some(a=>a.type===e.type&&a.seq===e.seq&&JSON.stringify(a.data)===JSON.stringify(e.data)));row.healthAfterAssistedCleanup=await h.healthy(30000);}}
  console.log(state,method,attempt,row.passed);save();
 }
}finally{await h.close();report.finishedAt=new Date().toISOString();report.passed=report.rows.length===(baseline?1:methodOnly?3:formationOnly?9:27)&&report.rows.every(r=>r.passed);save();}
