import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { phone,shell,shot,notifications,wait,pause,pkg } from './s3a-android.mjs';
const out=resolve('tests/evidence/s3a');mkdirSync(out,{recursive:true});
const report={nativeAndroid:true,syntheticAccounts:true,checks:[],errors:[]};
let p,f;
const notice=id=>notifications().find(row=>row.tag.endsWith(':'+id));
try{
 shell('shell','pm','clear',pkg);
 f=await startTimelineCandidate({interactive:true,s3a:true,historyCount:0,baseTime:Date.now()-10000});
 p=await phone(f.origin,f.credentials);p.page.on('pageerror',e=>report.errors.push(e.message));
 try{shell('shell','uiautomator','dump','/sdcard/s3a-permission.xml');}catch{ /* MuMu may return 139 after writing valid XML. */ }
 const permissionXml=shell('shell','cat','/sdcard/s3a-permission.xml');
 if(permissionXml.includes('permission_deny_button'))shell('shell','input','tap','360','760');
 const denied=await p.call('notifications.state');assert.equal(denied.systemAllowed,false);
 await p.page.evaluate(()=>page('notifications'));await p.page.getByText(/系统通知已关闭/).first().waitFor();await p.page.getByText(/系统通知已关闭/).first().scrollIntoViewIfNeeded();shot('permission-denied-light');report.checks.push('permission-denied-settings-recovery');
 shell('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');shell('shell','input','keyevent','4');
 await p.call('notifications.poll');
 const approval=(await f.request('/activity?filter=actionable')).items.find(row=>row.type==='approval.pending');assert.ok(approval);
 await wait(()=>notice(approval.id),'foreground approval');assert.deepEqual(notice(approval.id).actions,['批准','拒绝']);
 shell('shell','cmd','statusbar','expand-notifications');await pause(700);shot('notification-shade-light');
 shell('shell','cmd','uimode','night','yes');await pause(700);shot('notification-shade-dark');shell('shell','cmd','uimode','night','no');shell('shell','input','keyevent','4');
 // Press the actual system notification action, using its native accessibility bounds.
 shell('shell','cmd','statusbar','expand-notifications');await pause(400);
 try{shell('shell','uiautomator','dump','/sdcard/s3a-action.xml');}catch{}
 const actionXml=shell('shell','cat','/sdcard/s3a-action.xml');const approveNode=actionXml.match(/<node[^>]*text="批准"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
 assert.ok(approveNode,'visible native approval button');shell('shell','input','tap',String((Number(approveNode[1])+Number(approveNode[3]))/2),String((Number(approveNode[2])+Number(approveNode[4]))/2));
 await wait(async()=>{const row=(await f.request('/activity?filter=all')).items.find(r=>r.id===approval.id);return row?.state==='completed';},'notification approval receipt');
 await f.complete(true);const task=await wait(async()=>(await f.request('/activity?type=task')).items.find(r=>r.type==='task.completed'),'host continues');
 await wait(()=>notice(task.id),'foreground task');
 f.deliverReminder('S3a foreground reminder');const reminder=await wait(async()=>(await f.request('/activity?type=reminder')).items.find(r=>r.summary==='S3a foreground reminder'),'reminder projection');
 report.reminder={id:reminder.id,notification:reminder.notification,read:reminder.read,state:reminder.state};report.deviceBeforeReminder=await p.call('notifications.state');await p.call('notifications.poll');
 await wait(()=>notice(reminder.id),'foreground reminder');report.checks.push('foreground-approval-task-reminder','notification-approve-original-receipt-host-continues');
 await p.call('notifications.poll');await p.call('notifications.poll');assert.equal(notifications().filter(r=>r.tag.endsWith(':'+reminder.id)).length,1);report.checks.push('persistent-identity-dedup');
 await f.request(`/activity/${reminder.id}/read`,{requestId:randomUUID(),read:true,attentionRevision:reminder.attentionRevision},'PATCH');await p.call('notifications.poll');await wait(()=>!notice(reminder.id),'read cancellation');report.checks.push('read-and-handled-cancel');
 await p.page.evaluate(()=>page('notifications'));await p.page.getByText('已同步 · 通知规则立即生效',{exact:true}).waitFor();
 for(const theme of ['light','dark']){await p.page.evaluate(theme=>applyTheme(theme),theme);await pause(300);shot('settings-'+theme);await p.page.getByRole('button',{name:'查看后台运行设置',exact:true}).scrollIntoViewIfNeeded();shot('settings-device-'+theme);}
 await p.page.getByRole('button',{name:'发送测试通知',exact:true}).click();const test=await wait(async()=>(await f.request('/activity?type=system.notification.test')).items[0],'test activity');await wait(()=>notice(test.id),'real system test');report.checks.push('real-test-notification','five-categories-ten-channel-states');
 await f.request('/settings/notifications',{dndEnabled:true,dndStart:'00:00',dndEnd:'00:00',approvalException:false},'PATCH');f.deliverReminder('S3a quiet reminder');
 const quiet=await wait(async()=>(await f.request('/activity?type=reminder')).items.find(r=>r.summary==='S3a quiet reminder'),'dnd activity');await p.call('notifications.poll');assert.equal(quiet.notification.notify,false);assert.equal(notice(quiet.id),undefined);report.checks.push('dnd-only-activity-no-sound');
 await f.request('/settings/notifications',{dndEnabled:false,reminder:'notify'},'PATCH');shell('shell','input','keyevent','3');f.deliverReminder('S3a background silent reminder');
 const back=await wait(async()=>(await f.request('/activity?type=reminder')).items.find(r=>r.summary==='S3a background silent reminder'),'background reminder projection');await wait(()=>notice(back.id),'background notification');assert.ok(notice(back.id).channel.endsWith('-silent'));report.checks.push('living-background-reminder-host-sound-false');
 assert.ok(notifications().every(row=>!row.ongoing));report.checks.push('no-persistent-notification');
 await p.call('auth.logout');await p.close();p=null;await f.close();f=null;
 shell('shell','pm','clear',pkg);
 f=await startTimelineCandidate({interactive:true,inlineProgress:true,s3a:true,historyCount:0,baseTime:Date.now()-10000});
 p=await phone(f.origin,f.credentials);shell('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');shell('shell','input','keyevent','4');shell('shell','input','keyevent','3');
 const backgroundApproval=await f.progress.approve('background-call','echo S3a synthetic background action');
 const backgroundRow=await wait(async()=>(await f.request('/activity?filter=actionable')).items.find(r=>r.type==='approval.pending'),'background approval fact');
 await wait(()=>notice(backgroundRow.id),'background approval notification');
 f.deliverReminder('S3a background normal reminder');const backgroundReminder=await wait(async()=>(await f.request('/activity?type=reminder')).items.find(r=>r.summary==='S3a background normal reminder'),'background normal reminder fact');
 await wait(()=>notice(backgroundReminder.id),'background normal reminder notification');
 await f.request(`/sessions/${backgroundApproval.tuple.sessionId}/approvals/${backgroundApproval.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once'});
 f.progress.result('background-call','Synthetic background action completed.');f.progress.finish('completed');
 const backgroundTask=await wait(async()=>(await f.request('/activity?type=task')).items.find(r=>r.type==='task.completed'),'background task fact');
 await wait(()=>notice(backgroundTask.id),'background task notification');report.checks.push('living-background-approval-task-reminder');
 shell('shell','cmd','statusbar','expand-notifications');await pause(400);shot('background-notifications-light');shell('shell','cmd','uimode','night','yes');await pause(400);shot('background-notifications-dark');shell('shell','cmd','uimode','night','no');shell('shell','input','keyevent','4');
 await p.close(true);p=null;
 // Leave instrumentation mode, enter a normal app process, then kill only its background process.
 shell('shell','am','start','-W','-n',`${pkg}/com.memoweft.weftmate.mobile.HybridActivity`);shell('shell','input','keyevent','3');
 // am kill ends only this background process, unlike force-stop which disables jobs.
 shell('shell','am','kill',pkg);await pause(1000);let killedPid='';try{killedPid=shell('shell','pidof',pkg).trim();}catch{}if(killedPid){assert.match(killedPid,/^\d+$/);shell('shell','run-as',pkg,'kill','-9',killedPid);await pause(500);}let remainingPid='';try{remainingPid=shell('shell','pidof',pkg).trim();}catch{}assert.equal(remainingPid,'');
 f.deliverReminder('S3a worker catch-up');const catchup=await wait(async()=>(await f.request('/activity?type=reminder')).items.find(r=>r.summary==='S3a worker catch-up'),'missed reminder');
 const jobs=shell('shell','dumpsys','jobscheduler');const id=[...jobs.matchAll(new RegExp(`JOB #[^/]+/(\\d+):[^\\n]*${pkg.replaceAll('.','\\.')}/androidx.work.impl.background.systemjob.SystemJobService`,'g'))][0]?.[1];assert.ok(id,'WorkManager system Job registered');
 // Age only this QA WorkSpec so WorkManager's own eligibility check permits the
 // adb-forced periodic job; the OS's real 15-minute timing is deliberately not claimed.
 shell('shell',`run-as ${pkg} sqlite3 no_backup/androidx.work.workdb "UPDATE WorkSpec SET last_enqueue_time=0 WHERE worker_class_name='com.memoweft.weftmate.mobile.NotificationWorker';"`);
 shell('shell','cmd','jobscheduler','run','-f',pkg,id);
 await wait(()=>shell('shell','dumpsys','notification','--noredact').includes(':'+catchup.id),'worker killed-process catch-up');report.checks.push('killed-process-workmanager-adb-forced-job');report.workManager={jobId:id,agedQaWorkSpec:true,timeliness:'best effort; real OS timing is not guaranteed, 15 minutes or longer'};
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));writeFileSync(join(out,'mumu.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){writeFileSync(join(out,'mumu-failure.json'),JSON.stringify({error:error.message,report,notifications:notifications()},null,2));shot('failure');throw error;}
finally{await p?.close().catch(()=>{});if(f)shell('reverse','--remove',`tcp:${new URL(f.origin).port}`);await f?.close();shell('shell','cmd','uimode','night','no');}
