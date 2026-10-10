/** DSH schedule composition, native wake interception, and internal management. */
import * as schedule from '@deepseek-ai/dsh-schedule';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNativeScheduleManager, scheduleSourceReceipt } from '../personal-access/schedules-native.mjs';
import { scheduleContent } from '../personal-access/schedules-calendar.mjs';

export const name = 'weftmate-personal-schedules';
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence', 'webServer', 'weftmateSessionLifecycle'];
export const PROTOCOL = 'weftmate.personal-schedules.v1';
const personal = agent => agent?.session?.header?.agentPreset === 'personal-remote' && agent.session.header.origin !== 'subagent';

export async function apply(ctx) {
  const pending = new Map();
  const onMessage = frame => {
    if (frame?.protocol !== PROTOCOL || !pending.has(frame.id)) return;
    const entry = pending.get(frame.id); pending.delete(frame.id); clearTimeout(entry.timer);
    if (frame.ok) entry.resolve(frame.result); else entry.reject(new Error('SCHEDULE_HOST_UNAVAILABLE'));
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
    if (exec.name === 'schedule_delete' && result.value?.deleted) await manager.deleted(exec.agent, result.value.id);
    return result;
  });
  ctx.on('agent/created', ({ agent }) => {
    if (!personal(agent)) return;
    agent.ctx.tools.register(defineTool({ name: 'schedule_manage',
      description: 'List all reminders/tasks (including paused), or pause, resume, delete, or run one now in this conversation. Use the returned stable id.',
      parameters: { action: { type: 'string', enum: ['list', 'pause', 'resume', 'delete', 'run'], required: true }, id: { type: 'string' } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => manager.manage(exec.agent, args.action, args.id),
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
    const policy = await request({ action: 'context', sessionId: payload.agent.id });
    const guidance = `当前时间 ${new Date().toISOString()}；账号时区 ${policy.timeZone}。消息以“现在执行定时任务”开头时，这是已到点的任务，直接执行内容；只有用户明确指定时间或周期的提醒/定时执行才调用 schedule_create；“以后想组队时提醒我找某人”“以后喝这种茶时提醒加某物”属于情境记忆，由 MemoWeft 自动形成，不调用 load_tools、ask_user_question 或调度工具，也不追问时间频率；首次人物介绍的提醒提议与邀请确认按 shared-decisions 指引处理。用户交代有明确时间的提醒/定时执行时直接调用 schedule_create，WeftMate 的日历重复和定时执行适配已安装，不需要读源码或编写调度脚本。prompt 是完整 JSON 字符串，例如 {"weftmate":1,"kind":"reminder","text":"交报告"}；定时工作示例 {"weftmate":1,"kind":"task","text":"生成周报文件","repeat":{"kind":"weekly","time":"08:00:00","weekday":1}}。纯提醒 kind=reminder，届时执行 kind=task；daily 不填 weekday。首次时间由 at 或 after_seconds 指定，后续日历规则在 repeat 中，二者可以不同。at 的 time_zone 用账号时区。固定间隔用 every_seconds。一次性不填 repeat。成功后一句话复述本地时间、规则、内容；失败不能说已建立。取消/暂停/恢复先 schedule_manage list，再操作准确 id。`;
    return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'plugin', plugin: name }, content: [{ type: 'text', text: guidance }] })] };
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
      const result = await manager.manage(agent, input.action, input.id);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(error.status ?? 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.status === 404 ? 'NOT_FOUND' : 'SCHEDULE_UNAVAILABLE' })); }
  } }), 'schedules management HTTP');
  ctx.effect(() => async () => {
    process.off('message', onMessage);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('SCHEDULE_HOST_UNAVAILABLE')); }
    pending.clear(); await manager.close();
  }, 'schedules lifecycle');
}
