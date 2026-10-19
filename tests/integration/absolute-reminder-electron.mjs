/** H5/#552: real source Electron + pinned DSH + MiMo, no scripted model responses. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { decodeStorageRecord } from '../../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session/lib/index.js';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

async function scheduleCalls(root, callIds) {
  const directory=join(root,'dsh-home','sessions'), result=[];
  for(const file of (await readdir(directory,{recursive:true})).filter(name=>name.endsWith('session.jsonl.zstd'))) {
    const bytes=await readFile(join(directory,file));let offset=0,text='';
    while(offset<bytes.length){const frame=zstdDecompressSync(bytes.subarray(offset),{info:true});offset+=frame.engine.bytesWritten;text+=frame.buffer.toString();}
    for(const line of text.trim().split('\n')) {
      const row=JSON.parse(line);if(row.type==='session')continue;
      for(const event of decodeStorageRecord(row)) if(event.type==='tool/call'&&event.data.name==='schedule_create'&&callIds.has(event.data.callId))
        result.push(JSON.parse(event.data.arguments));
    }
  }
  return result;
}
const fixture=await sourceModelDesktop('552');
const {page,api,until,events,send,capture,report,root}=fixture;
let failure;
try {
  await api('/settings/usage',{timeZone:'Asia/Shanghai'},'PATCH');
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const today=local.slice(0,10), tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  assert.ok(local.slice(11)<'18:30','Run the today 18:30 case before 18:30; do not change the system clock');
  report.cases=[];
  for(const scenario of [
    {text:'明天 9 点提醒我喝水',content:'喝水',date:tomorrow,time:'09:00:00'},
    {text:'今天 18:30 提醒我开会',content:'开会',date:today,time:'18:30:00'}
  ]) {
    await page.evaluate(()=>scenarioCore.startNewConversation());
    await send(scenario.text);
    const sessionId=await until(()=>page.evaluate(()=>scenarioCore.state.selectedSessionId),'reminder session');
    const rows=await until(async()=>{const rows=await events(sessionId);return rows.some(row=>row.type==='turn.ended')&&rows;},'actual reminder reply',120000);
    const list=await api('/schedules'), saved=list.items.filter(row=>row.sessionId===sessionId&&row.text.includes(scenario.content));
    assert.equal(saved.length,1,'exactly one actual reminder persisted for this request');
    const expected=new Date(scenario.date+'T'+scenario.time+'+08:00').toISOString();
    assert.equal(saved[0].nextRunAt,expected);assert.equal(saved[0].timeZone,'Asia/Shanghai');assert.equal(saved[0].state,'scheduled');
    const calls=rows.filter(row=>row.type==='step.started'&&row.data.toolName==='schedule_create');
    assert.equal(calls.length,1,'one successful creation, without repeated failed attempts');
    const args=await scheduleCalls(root,new Set(calls.map(row=>row.data.callId)));
    assert.equal(args.length,1);assert.deepEqual(args[0].at,{date:scenario.date,time:scenario.time,time_zone:'Asia/Shanghai'});
    assert.equal(args[0].after_seconds,undefined,'absolute time stays a local calendar input');
    const reply=rows.filter(row=>row.type==='assistant.message').map(row=>row.data.text).join('\n');
    assert.ok(reply.includes(scenario.content));
    report.cases.push({request:scenario.text,at:args[0].at,nextRunAt:saved[0].nextRunAt,scheduleCreateCalls:calls.length,reply});
    await capture(scenario.content==='喝水'?'tomorrow-water-saved':'today-meeting-saved');
  }
  await page.getByRole('button',{name:'目标',exact:true}).click();
  const schedules=page.getByRole('region',{name:'定时任务',exact:true});
  await schedules.getByRole('article',{name:'喝水',exact:true}).waitFor();
  await schedules.getByRole('article',{name:'开会',exact:true}).waitFor();
  assert.equal(await schedules.locator('.goals-row').count(),2,'both rows are in Scheduled Tasks, not just conversation activity');
  const scheduleText=await schedules.innerText();
  assert.ok(scheduleText.includes('9:00')&&scheduleText.includes('18:30'),'goal rows display the saved local times');
  await schedules.scrollIntoViewIfNeeded();
  report.goalsReminders=await schedules.locator('.goals-row').allTextContents();
  report.goalsPageVisible=true;await capture('goals-both-reminders');
  report.passed=true;
  console.log('552 PASS: both exact requests saved once with the correct account-local times and visible on Goals');
} catch(error){failure=error;await capture('failure').catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{await fixture.close(failure);}
