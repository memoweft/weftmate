import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';
import { createNativeScheduleManager } from '../src/personal-access/schedules-native.mjs';
const native = await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-schedule/lib/index.js');
const { validateJsonSchemaValue } = await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js');

function fixture() {
  const definitions = new Map(), events: any[] = [];
  const agent: any = { id:'reminder-fixture', session:{ header:{seedLength:0}, events,
    append(type: string, data: unknown) { const event={type,data,seq:events.length}; events.push(event); return event; } } };
  const ctx: any = { tools:{register:(tool: any)=>{definitions.set(tool.name,tool);return()=>{};},get:(name: string)=>definitions.get(name)},
    sessions:{flush:async()=>true},logger:{warn(){}} };
  native.registerScheduleTools(ctx,ctx,agent,()=>{});
  const tool=definitions.get('schedule_create'), original=JSON.stringify(tool.parameters);
  const projected=presentPersonalPrompt({sections:[],tools:[tool]},new Set(['schedule_create'])).tools[0];
  return {ctx,agent,tool,projected,original};
}

test('model schedule at accepts native local objects and rejects the JSON-encoded object from #552', () => {
  const f=fixture(), prompt=JSON.stringify({weftmate:1,kind:'reminder',text:'合成提醒'});
  const at={date:'2026-10-20',time:'09:00:00',time_zone:'Asia/Shanghai'};
  assert.throws(()=>native.createAtScheduleRecord('bad','synthetic',JSON.stringify(at),Date.parse('2026-10-19')), {code:'invalid_rule'});
  assert.ok(validateJsonSchemaValue(f.projected.parameters,{prompt,at:JSON.stringify(at)}).length>0,
    'model schema must reject the serialized object that repeatedly failed as an offset string');
  assert.deepEqual(validateJsonSchemaValue(f.projected.parameters,{prompt,at}),[]);
  for(const invalid of [{date:at.date,time:at.time},{...at,extra:'unrecognized'},'2026-10-20 09:00']) {
    assert.ok(validateJsonSchemaValue(f.projected.parameters,{prompt,at:invalid}).length>0);
  }
  assert.equal(JSON.stringify(f.tool.parameters),f.original,'native registry retains its full original schema');
  for(const name of ['prompt','after_seconds','every_seconds']) {
    assert.deepEqual(f.projected.parameters.properties[name],f.tool.parameters.properties[name]);
  }
  assert.deepEqual(f.projected.parameters.required,f.tool.parameters.required);
  const repeated=presentPersonalPrompt({sections:[],tools:[f.projected]},new Set(['schedule_create'])).tools[0];
  assert.deepEqual(repeated.parameters,f.projected.parameters,'repeated prompt assembly preserves the canonical contract');
});

test('two local absolute times persist through native scheduling and management restart', async t => {
  const now=Date.parse('2026-10-19T06:30:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const f=fixture(), root=await mkdtemp(join(tmpdir(),'absolute-schedule-')), file=join(root,'schedules.json');
  const request=async()=>({timeZone:'Asia/Shanghai',approvalMode:'ask'});
  let manager=await createNativeScheduleManager({ctx:f.ctx,native,file,request,clock:()=>now});
  try {
    for(const [text,date,time,expected] of [
      ['喝水','2026-10-20','09:00:00','2026-10-20T01:00:00.000Z'],
      ['开会','2026-10-19','18:30:00','2026-10-19T10:30:00.000Z']
    ]) {
      const args={prompt:JSON.stringify({weftmate:1,kind:'reminder',text}),at:{date,time,time_zone:'Asia/Shanghai'}};
      assert.deepEqual(validateJsonSchemaValue(f.projected.parameters,args),[]);
      const record=await f.tool.execute(args,{agent:f.agent,signal:new AbortController().signal});
      assert.ok(record.id,JSON.stringify(record)); assert.equal(record.scheduledAt,expected);
      await manager.register(f.agent,record,'synthetic-receipt');
    }
    await manager.close();
    manager=await createNativeScheduleManager({ctx:f.ctx,native,file,request,clock:()=>now});
    const rows=(await manager.manage(f.agent,'list')).items;
    assert.deepEqual(rows.map((row: any)=>[row.text,row.nextRunAt,row.timeZone]),[
      ['喝水','2026-10-20T01:00:00.000Z','Asia/Shanghai'],
      ['开会','2026-10-19T10:30:00.000Z','Asia/Shanghai']
    ]);
    const offset=await f.tool.execute({prompt:'native offset compatibility',at:'2026-10-21T09:00:00+08:00'},
      {agent:f.agent,signal:new AbortController().signal});
    assert.equal(offset.scheduledAt,'2026-10-21T01:00:00.000Z','native offset API remains supported');
  } finally {await manager.close();await rm(root,{recursive:true,force:true});}
});
