/** Management adapter over DSH's native schedule tools, never a timer service. */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scheduleContent, nextCalendarInput } from './schedules-calendar.mjs';

export async function createNativeScheduleManager({ ctx, native, file, request, clock = Date.now }) {
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, sessions: {} }; }
  if (state.version !== 1 || !state.sessions) throw new Error('SCHEDULE_STORE_CORRUPT');
  let queue = Promise.resolve();
  const serial = work => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
  async function save() {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state)); await rename(temp, file);
  }
  const bucket = sessionId => state.sessions[sessionId] ??= { items: {}, notifications: [] };
  const folded = agent => native.foldScheduleEvents(agent.session.events, agent.session.header.seedLength ?? 0).active;
  const call = (agent, name, args) => {
    const tool = ctx.tools.get(name, agent);
    if (!tool) throw new Error('SCHEDULE_UNAVAILABLE');
    return tool.execute(args, { agent, signal: new AbortController().signal });
  };
  const requireSuccess = value => { if (!value || value.code) throw Object.assign(new Error(value?.code ?? 'SCHEDULE_UNAVAILABLE'), { code: value?.code }); return value; };
  async function register(agent, record, sourceReceiptId) {
    const policy = await request({ action: 'context', sessionId: agent.id });
    const content = scheduleContent(record.prompt);
    return serial(async () => {
      const row = { id: record.id, nativeId: record.id, prompt: record.prompt, ...content, timeZone: policy.timeZone,
        approvalMode: policy.approvalMode, ...(sourceReceiptId ? { sourceReceiptId } : {}), state: 'scheduled', record, createdAt: new Date(clock()).toISOString() };
      bucket(agent.id).items[row.id] = row; await save(); return row;
    });
  }
  function items(agent) {
    const active = folded(agent), rows = bucket(agent.id).items;
    return Object.values(rows).filter(row => row.state !== 'deleted').map(row => {
      const current = active.find(record => record.id === row.nativeId);
      return { id: row.id, nativeId: row.nativeId, text: row.text, kind: row.kind, timeZone: row.timeZone,
        repeat: row.repeat ?? (row.record.kind === 'every' ? { kind: 'interval', seconds: row.record.everySeconds } : null),
        state: row.state === 'paused' ? 'paused' : current ? 'scheduled' : row.state,
        nextRunAt: row.state === 'paused' ? null : current?.scheduledAt ?? null, lastRunAt: row.lastRunAt ?? null,
        approvalMode: row.approvalMode };
    });
  }
  async function renew(agent, row) {
    const now = clock();
    let args;
    if (row.repeat) {
      let at = nextCalendarInput(row.repeat, row.timeZone, now);
      // A recurring local time may disappear at spring DST. Skip that calendar
      // occurrence instead of letting one rejected native at end the series.
      while (true) {
        try { native.createAtScheduleRecord(row.id, row.prompt, at, now); break; }
        catch (error) {
          if (error.code !== 'invalid_rule') throw error;
          at = nextCalendarInput(row.repeat, row.timeZone, now, at.date);
        }
      }
      args = { prompt: row.prompt, at };
    }
    else if (row.record.kind === 'every') {
      const target = Date.parse(row.record.scheduledAt), interval = row.record.everySeconds * 1000;
      const next = target > now ? target : target + (Math.floor((now - target) / interval) + 1) * interval;
      // Native every starts at creation time; preserve the user's anchor with a
      // native one-shot, renewing anchor-aligned native targets after delivery.
      args = { prompt: row.prompt, at: new Date(next).toISOString() };
    } else args = { prompt: row.prompt, at: new Date(Math.max(now + 1000, Date.parse(row.record.scheduledAt))).toISOString() };
    const result = requireSuccess(await call(agent, 'schedule_create', args));
    row.nativeId = result.id; row.state = 'scheduled'; row.nextRecord = result;
  }
  async function deliver(agent, row, occurrenceAt, deliveryId, manual = false) {
    if (bucket(agent.id).notifications.some(n => n.id === deliveryId)) return;
    const missed = !manual && clock() - Date.parse(occurrenceAt) >= 60000;
    const local = new Date(occurrenceAt).toLocaleString('zh-CN', { timeZone: row.timeZone });
    const text = `${missed ? `错过了 ${local} 的${row.kind === 'task' ? '定时任务' : '提醒'}，现在补${row.kind === 'task' ? '执行' : '提醒'}：` : row.kind === 'task' ? '定时任务：' : '提醒：'}${row.text}`;
    if (row.kind === 'task') await request({ action: 'execute', sessionId: agent.id, text: `这是已到点的定时任务，请现在执行以下工作，沿用本对话审批模式，不要重新建立该定时任务：\n${text}`, deliveryId, sourceReceiptId: row.sourceReceiptId });
    const message = native.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'weftmate-reminder' } });
    agent.session.append('user/message', message, { surfaceOp: 'append' });
    await ctx.sessions.flush(agent.session);
    bucket(agent.id).notifications.push({ id: deliveryId, text, kind: row.kind, scheduledAt: occurrenceAt,
      createdAt: new Date(clock()).toISOString(), missed, messageId: message.id });
    row.lastRunAt = new Date(clock()).toISOString();
  }
  async function due(agent) {
    return serial(async () => {
      const rows = bucket(agent.id).items;
      const events = agent.session.events;
      const active = folded(agent);
      for (const row of Object.values(rows).filter(row => row.state === 'scheduled')) {
        const dispatch = events.findLast(event => event.type === 'schedule/change' && event.data.operation === 'dispatch' && event.data.id === row.nativeId);
        if (!dispatch || dispatch.seq <= (row.lastDispatchSeq ?? -1)) continue;
        const deliveryId = `${row.nativeId}-${dispatch.seq}`;
        const occurrence = row.record.kind === 'every'
          ? native.resolveEveryOccurrence(row.record, dispatch.data.acceptedAt ? Date.parse(dispatch.data.acceptedAt) : clock()).occurrenceAt
          : (row.nextRecord ?? row.record).scheduledAt;
        await deliver(agent, row, occurrence, deliveryId);
        if (row.repeat) {
          if (!active.some(r => r.id === row.nativeId)) await renew(agent, row);
        } else if (row.record.kind === 'every') {
          const current = active.find(r => r.id === row.nativeId);
          if (current) row.record = current;
          else await renew(agent, row);
        } else row.state = 'completed';
        row.lastDispatchSeq = dispatch.seq;
        await save();
      }
    });
  }
  async function manage(agent, action, id) {
    if (action === 'list') return { items: items(agent) };
    if (action === 'notifications') return { items: structuredClone(bucket(agent.id).notifications) };
    return serial(async () => {
      const row = bucket(agent.id).items[id];
      if (!row || row.state === 'deleted') throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
      const current = folded(agent).find(r => r.id === row.nativeId);
      if (action === 'pause' || action === 'delete') {
        if (current) { row.nextRecord = current; requireSuccess(await call(agent, 'schedule_delete', { id: row.nativeId })); }
        row.state = action === 'pause' ? 'paused' : 'deleted';
      } else if (action === 'resume') { if (row.state === 'paused') { row.record = row.nextRecord ?? row.record; await renew(agent, row); } }
      else if (action === 'run') await deliver(agent, row, new Date(clock()).toISOString(), `manual-${randomUUID()}`, true);
      else throw Object.assign(new Error('INVALID_REQUEST'), { status: 400 });
      await save(); return { ok: true };
    });
  }
  async function deleted(agent, nativeId) {
    return serial(async () => {
      const row = Object.values(bucket(agent.id).items).find(r => r.nativeId === nativeId);
      if (row) { row.state = 'deleted'; await save(); }
    });
  }
  return { register, due, manage, deleted, close: () => queue,
    hasSession: id => !!state.sessions[id],
    restoreSessionIds: () => Object.entries(state.sessions).filter(([, b]) => Object.values(b.items).some(r => r.state === 'scheduled')).map(([id]) => id) };
}
