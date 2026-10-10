// One-time, explicitly authorized NIGHT-2 leftovers; never an automatic nightly phase.
import { execFileSync } from 'node:child_process';
import { open, rm, writeFile } from 'node:fs/promises';
import { androidBusyReason } from './android-packages.mjs';
const adb='D:/Software/MuMuPlayer/nx_main/adb.exe', serial='127.0.0.1:7555';
const lock='D:/AIProjects/WeftMate/Runtime/Orchestrator/mumu.lock';
const handle=await open(lock,'wx'); await handle.writeFile('NIGHT-2 legacy package cleanup'); await handle.close();
const command=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
try {
  const packages=command('shell','pm','list','packages','weftmate');
  const processes=command('shell','ps','-A','-o','NAME');
  const instrumentation=command('shell','dumpsys','activity');
  const host=execFileSync('pwsh',['-NoProfile','-Command',`[bool]@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -notin @($PID,${process.pid}) -and $_.CommandLine -match 'review-capture-mobile[^\r\n]*--android|weftmateApplicationId|NightlyWebViewProbeTest|adb[^\r\n]*\\bam\\s+instrument|weftmate[^\r\n]*android[^\r\n]*(?:test|probe)' }).Count`],{encoding:'utf8',windowsHide:true});
  const reason=androidBusyReason(packages,processes,instrumentation,host.trim()==='True'?['review-capture-mobile --android']:[]);
  if(reason) throw Error(reason);
  const removed=[];
  for(const pkg of ['com.memoweft.weftmate.mobile.debug.test','com.memoweft.weftmate.mobile.stage15memoryqa.test','com.memoweft.weftmate.mobile.stage15releaseqa.test']) {
    if (!packages.split(/\r?\n/).some(line=>line.trim()==='package:'+pkg)) continue;
    if(command('uninstall',pkg).trim()!=='Success') throw Error('卸载未确认：'+pkg);
    removed.push(pkg);
  }
  const result={removed,occupancy:'持有 MuMu 锁；设备无 WeftMate 进程 / 活动仪器测试；Windows 无安卓测试命令',at:new Date().toISOString()};
  await writeFile('.local/night-2/legacy-cleanup.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { await rm(lock,{force:true}); }
