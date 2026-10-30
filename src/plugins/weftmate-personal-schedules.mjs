/** DSH schedule composition, native wake interception, and internal management. */
import * as schedule from '@deepseek-ai/dsh-schedule';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNativeScheduleManager, scheduleSourceReceipt } from '../personal-access/schedules-native.mjs';
import { scheduleContent } from '../personal-access/schedules-calendar.mjs';
import { foldGoal } from '@deepseek-ai/dsh-goal';
import { createNativeGoalManager } from '../personal-access/goals-native.mjs';
import { isHealthQuestion } from './personal-prompt.mjs';
import { installAccountScheduleQuery, installAccountScheduleDelete } from './personal-schedule-query.mjs';
/** Goal-only model guidance; native transitions, round admission and budgets stay in DSH. */
const guidance = 'Follow the objective\'s actual completion conditions. Native goal continuations support reasoning and session tools such as goal state and todo_write; they do not inherit a human turn\'s computer authorization. When the user requires multiple rounds that can be done with these supported capabilities, each requested round must be a distinct native <goal_round> continuation with its own recorded result. Multiple calculations, planned todos, or results narrated in the creating human turn cannot substitute for those rounds. For such a supported multi-round goal, create its plan, keep it active and end the human reply so the native driver can admit round 1; do not call complete in that setup turn. In each admitted goal round, do and record the next supported work. If supported rounds remain, keep the goal active and end this reply for the next continuation. Before completing, call get_goal and verify that its admitted rounds and actual records satisfy the user\'s requested rounds and every other condition. max_goal_rounds is only a continuation budget cap, never a required minimum: a single-step or already achieved objective may complete in the human turn or before the cap; do not pad rounds. Pause, cancellation, failure and unmet waiting conditions must use native controls, without forcing progress or claiming completion.'
  + '\n\nComputer-tool boundary: For objectives requiring computer tools (read/write files, commands or application actions), continue the current authorized human turn to perform the work currently possible under its existing project, permissions and approvals. Creating a goal must not force an early end before those actions. Native goal rounds cannot execute these computer actions without an authorized human continuation. If remaining independent rounds require computer actions, first do the currently authorized work, then pause the goal and explain that the remaining work needs human continuation. Do not promise automatic background computer actions or claim those rounds complete. Repeating actions in one human turn does not count as independent goal rounds. Never forge human provenance, bypass approval or retry rejected work.';

export function presentPersonalGoalWorkflow(assembly) {
  return { ...assembly, sections: assembly.sections.map(section => section.name === 'tool:goal' && !section.text.endsWith(guidance)
    ? { ...section, text: `${section.text}\n\n${guidance}` } : section) };
}

export const name = 'weftmate-personal-schedules';
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence', 'webServer', 'weftmateSessionLifecycle'];
export const PROTOCOL = 'weftmate.personal-schedules.v1';
const personal = agent => agent?.session?.header?.agentPreset === 'personal-remote' && agent.session.header.origin !== 'subagent';

export async function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    return personal(context.scope) ? presentPersonalGoalWorkflow(assembly) : assembly;
  });
  const pending = new Map();
  const onMessage = frame => {
    if (frame?.protocol !== PROTOCOL || !pending.has(frame.id)) return;
    const entry = pending.get(frame.id); pending.delete(frame.id); clearTimeout(entry.timer);
    if (frame.ok) entry.resolve(frame.result); else entry.reject(Object.assign(new Error(frame.error ?? 'SCHEDULE_HOST_UNAVAILABLE'),{code:frame.error ?? 'SCHEDULE_HOST_UNAVAILABLE'}));
  };
  process.on('message', onMessage);
  const request = input => new Promise((resolve, reject) => {
    if (!process.connected) { reject(new Error('SCHEDULE_HOST_UNAVAILABLE')); return; }
    const id = `schedule-${randomUUID()}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('SCHEDULE_HOST_UNAVAILABLE')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    process.send({ protocol: PROTOCOL, id, ...input });
  });
  const manager = await createNativeScheduleManager({ ctx, native: { ...schedule, createUserMessage }, request,
    file: path.join(process.env.DSH_HOME, 'personal-schedules.json') });
  const goalManager = await createNativeGoalManager({ ctx, foldGoal, file: path.join(process.env.DSH_HOME, 'personal-goal-requests.json') });
  // Use the official runtime, including its transaction and durability barriers.
  schedule.apply(ctx);
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (personal(exec.agent) && exec.name === 'schedule_create') {
      scheduleContent(exec.arguments.prompt); scheduleSourceReceipt(exec);
    }
    return next();
  });
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next();
    if (!personal(exec.agent) || result.isError || result.value?.code) return result;
    if (exec.name === 'schedule_create' && result.value?.id) await manager.register(exec.agent, result.value, scheduleSourceReceipt(exec));
    if (exec.name === 'create_goal') await goalManager.register(exec.agent, scheduleSourceReceipt(exec));
    return result;
  });
  ctx.on('agent/created', ({ agent }) => {
    if (!personal(agent)) return;
    manager.bindNativeTools(agent);
    installAccountScheduleQuery(ctx.tools, agent, request);
    installAccountScheduleDelete(ctx.tools, agent, request);
    agent.ctx.tools.register(defineTool({name:'health_query',
      description:'查询本人健康汇总。问睡眠、恢复、负荷、压力、电能、体能年龄、熬夜关联时先查再答；只比较自己平时，不诊断，不提疾病名或建议用药。未接上或缺测就明确说明。',
      parameters:{metric:{type:'string',required:true,enum:['overview','restingHeartRateBpm','hrvSdnnMs','respiratoryRateBrpm','spo2Pct','wristTempC','vo2Max','activeEnergyKcal','exerciseMinutes','steps','sleepMinutes','inBedMinutes','deepMinutes','coreMinutes','remMinutes','awakeMinutes','recovery','sleep','load','stress','energy','fitnessAge','usageActiveMinutes','usageLateNightMinutes','heartRateAvgBpm','heartRateMinBpm','heartRateMaxBpm','workoutMinutes'],description:'overview 或指定指标'},from:{type:'string',description:'账号时区 YYYY-MM-DD，默认最近7天'},to:{type:'string',description:'账号时区 YYYY-MM-DD，最多90天'}},
      output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      execute:(args,exec)=>request({action:'health_query',sessionId:exec.agent.id,sourceReceiptId:scheduleSourceReceipt(exec),query:args}),
      presentCall:()=>({card:'generic',title:'查看健康趋势',kind:'other'})}));
    agent.ctx.tools.register(defineTool({ name: 'schedule_manage',
      description: 'List reminders/tasks across this account. For pause/resume/delete/run, pass the exact sessionId AND id from the list. An id alone is ambiguous across conversations.',
      parameters: { action: { type: 'string', enum: ['list', 'pause', 'resume', 'delete', 'run'], required: true }, id: { type: 'string' },sessionId:{type:'string'} },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => {
        if (args.action !== 'list' && (!args.sessionId || !args.id)) throw new ToolArgsError(['Pass sessionId and id from schedule_list to identify the target reminder.']);
        return request({action:args.action==='list'?'schedule_list':'schedule_manage',sessionId:exec.agent.id,
          operation:args.action,targetSessionId:args.sessionId,scheduleId:args.id,sourceReceiptId:scheduleSourceReceipt(exec)});
      },
      presentCall: () => ({ card: 'generic', title: '管理提醒与定时任务', kind: 'other' }) }));
  });
  ctx.on('agent/pre-step', async (payload, next) => {
    if (!personal(payload.agent)) return next();
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    if (payload.messages?.some(m => m.source?.plugin === 'schedule')) {
      await manager.due(payload.agent);
      // Reminder text is appended without inference. Executable work is queued
      // through the owner's ordinary command path, so native approval applies.
      return { kind: 'enter', messages: decision.messages.filter(m => m.source?.kind === 'user') };
    }
    if (!payload.messages?.some(m => m.source?.kind === 'user')) return decision;
    const latest=payload.messages.findLast(m=>m.source?.kind==='user'),question=(latest?.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
    const healthGuidance=isHealthQuestion(question)?'\n本人正在查询自己的健康记录：必须先调用 load_tools 加载 health_query，再调用 health_query（metric=overview，默认最近7天）取得最新数据后回答。不要只根据背景摘要回答；stress.latest 是最近一次测量；stress.score 表示最近一次测量的分数，不是均值；stress.average 才是当日已有测量的平均值。metric=stress 时 items[].value 同样是当天最近一次测量的压力分数，不能说成当日均值。指标序列的 value 依指标含义，不能把最近一次测量说成均值；没有平均值时不自行补算。睡眠等时长换成几小时几分，例如 466 分钟说成 7 小时 46 分。工具返回还没接上／缺测就照实说。只比本人平时，不诊断、不提疾病名、不建议用药，使用与睡眠的同时变化不能说成因果。':'';
    const policy = await request({ action: 'context', sessionId: payload.agent.id });
    const guidance = `当前时间 ${new Date().toISOString()}；账号时区 ${policy.timeZone}；账号本地时间 ${new Date().toLocaleString('sv-SE', { timeZone: policy.timeZone })}。每天、每周、每月的安排优先用账号本地 at 指定下一次日期与时间，不用 after_seconds 计算时差（除非用户明确要求延迟后开始）。消息以“现在执行定时任务”开头时，这是已到点的任务，直接执行内容；只有用户明确指定时间或周期的提醒/定时执行才调用 schedule_create；“以后想组队时提醒我找某人”“以后喝这种茶时提醒加某物”属于情境记忆，由 MemoWeft 自动形成，不调用 load_tools、ask_user_question 或调度工具，也不追问时间频率；首次人物介绍的提醒提议与邀请确认按 shared-decisions 指引处理。用户交代有明确时间的提醒/定时执行时直接调用 schedule_create，WeftMate 的日历重复和定时执行适配已安装，不需要读源码或编写调度脚本。prompt 是完整 JSON 字符串，例如 {"weftmate":1,"kind":"reminder","text":"交报告"}；定时工作示例 {"weftmate":1,"kind":"task","text":"生成周报文件","repeat":{"kind":"weekly","time":"08:00:00","weekday":1}}。纯提醒 kind=reminder，届时执行 kind=task；daily 不填 weekday。首次时间由 at 或 after_seconds 指定，后续日历规则在 repeat 中，二者可以不同。at 的 time_zone 用账号时区。固定间隔用 every_seconds。一次性不填 repeat。成功后一句话复述本地时间、规则、内容；失败不能说已建立。取消/暂停/恢复先 schedule_manage list，再传所选条目的 sessionId 和 id；编号在不同对话中会重复，不能只传 id。`;
    return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'plugin', plugin: name }, content: [{ type: 'text', text: guidance+healthGuidance }] })] };
  }, { prepend: true });
  const lifecycle = ctx.get('weftmateSessionLifecycle');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/weftmate/schedules', handler: async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://runtime').pathname;
      let body = '';
      for await (const part of req) { body += part; if (body.length > 32768) throw new Error('INVALID_REQUEST'); }
      const input = body ? JSON.parse(body) : {};
      if (pathname === '/weftmate/schedules/restore' && req.method === 'POST') {
        for (const id of manager.restoreSessionIds().filter(id => input.sessionIds?.includes(id))) {
          if (!ctx.agents.get(id)) await lifecycle.resume(id);
          await manager.due(ctx.agents.get(id));
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return;
      }
      const match = /^\/weftmate\/schedules\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (!match || req.method !== 'POST') throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      const id = match[1];
      if (['list', 'notifications'].includes(input.action) && !manager.hasSession(id)) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ items: [] })); return;
      }
      let agent = ctx.agents.get(id);
      if (!agent && ['list', 'notifications'].includes(input.action)) {
        const stored = await ctx.sessionPersistence.inspect(id);
        agent = { id, session: { header: stored.meta, events: stored.events } };
      } else if (!agent) { await lifecycle.resume(id); agent = ctx.agents.get(id); }
      if (!personal(agent)) throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      const result = await manager.manage(agent, input.action, input.id, input);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(error.status ?? 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.status ? error.message : 'SCHEDULE_UNAVAILABLE' })); }
  } }), 'schedules management HTTP');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/weftmate/goals', handler: async (req, res) => {
    try {
      const match = /^\/weftmate\/goals\/([A-Za-z0-9_-]+)$/.exec(new URL(req.url, 'http://runtime').pathname);
      if (!match || req.method !== 'POST') throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      let body = ''; for await (const part of req) { body += part; if (body.length > 32768) throw Object.assign(new Error('INVALID_REQUEST'), { status: 400 }); }
      const input = JSON.parse(body), id = match[1]; let agent = ctx.agents.get(id);
      if (!agent && input.action === 'list') { const stored = await ctx.sessionPersistence.inspect(id); agent = { id, session: { header: stored.meta, events: stored.events } }; }
      else if (!agent) { await lifecycle.resume(id); agent = ctx.agents.get(id); }
      if (!personal(agent)) throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      const result = await goalManager.manage(agent, input);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { const status = error.status ?? (error.code?.startsWith('GOAL_') ? 409 : 503); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.code?.startsWith('GOAL_') ? error.code : error.status ? error.message : 'GOAL_UNAVAILABLE' })); }
  } }), 'native goals management');
  ctx.effect(() => async () => {
    process.off('message', onMessage);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('SCHEDULE_HOST_UNAVAILABLE')); }
    pending.clear(); await manager.close(); await goalManager.close();
  }, 'schedules lifecycle');
}
