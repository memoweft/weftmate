import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { durableWrite } from '../personal-access/store.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { memorySuccessors } from './world-projection.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const pendingMessage = name => name === 'memory_forget'
  ? '这次还没忘掉，稍后会再试。' : '这次还没记住，稍后会再试。';
const notFound = () => ({ state: 'not_found', message: '没找到这条记忆。' });
const changedScope = partial => ({ state: partial ? 'partial' : 'withheld', message: partial
  ? '部分记忆已删除，但其余内容在确认后发生了变化，没有继续删除；请重新确认。'
  : '记忆在原来确认后发生了变化，这次没有删除；请重新确认要忘掉的内容。' });

/** Durable user intents. Core remains the only authority for facts and receipts. */
export function createMemoryActions({ root, manager, schedule }) {
  const queues = new Map(), flights = new Map();
  // Live request cancellation only; never persisted as another work queue.
  const liveSignals = new Map();
  const file = owner => path.join(root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  const serial = (owner, fn) => {
    const work = (queues.get(owner) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, work.catch(() => {})); return work;
  };
  async function read(owner) {
    try { await ensurePrivateFile(file(owner)); return JSON.parse(await readFile(file(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { records: {} }; throw error; }
  }
  async function update(owner, fn) {
    return serial(owner, async () => {
      await ensurePrivateDirectory(path.dirname(file(owner)));
      const data = await read(owner), result = fn(data);
      await durableWrite(file(owner), data); return result;
    });
  }
  async function perform(owner, action, signal) {
    const m = manager();
    signal?.throwIfAborted();
    if (action.name === 'memory_forget') {
      // A pre-upgrade frozen plan has not passed whole-message/subject checks.
      // Rebuild it from the original request before resuming any deletion.
      if (!action.plan || action.plan.version !== 2 || !Number.isSafeInteger(action.plan.worldRevision) || action.plan.authorization?.authorized !== true) {
        const previous = action.plan;
        const plan = await m.planForget(owner, { ...action, signal });
        signal?.throwIfAborted();
        if (previous) {
          const evidence = new Set(previous.authorizedEvidenceIds ?? previous.evidenceIds ?? []);
          const items = new Set([...(previous.affectedIds ?? []), ...(previous.worldTargets ?? []).map(row => row.id)]);
          if ((plan.authorizedEvidenceIds ?? plan.evidenceIds ?? []).some(id => !evidence.has(id)) ||
              (plan.affectedIds ?? []).some(id => !items.has(id))) return changedScope(Boolean(action.finished?.length));
        }
        await update(owner, data => { data.records[action.requestId].plan = plan; }); action.plan = plan;
      }
      const deletions = [...(action.plan.worldTargets ?? []), ...action.plan.evidenceIds.map(id => ({ kind: 'evidence', id }))];
      const retained = (action.plan.retainedOtherCount ? `还有 ${action.plan.retainedOtherCount} 条关于别人的没动。` : '') +
        (action.plan.retainedUncertainCount ? `还有 ${action.plan.retainedUncertainCount} 条归属或共用来源不明确的没动。` : '');
      if (!deletions.length) return action.plan.state ? { state: action.plan.state, message: action.plan.message }
        : retained ? { state: 'withheld', message: '这次没有删除记忆。' + retained } : notFound();
      if (!Number.isSafeInteger(action.plan.nextRevision ?? action.plan.worldRevision)) return changedScope(Boolean(action.finished?.length));
      for (const target of deletions) {
        signal?.throwIfAborted();
        const id = target.kind === 'evidence' ? target.id : `${target.kind}:${target.id}`;
        if (action.finished?.includes(id)) continue;
        let command = action.commands?.[id];
        if (!command) {
          const revision = action.plan.nextRevision ?? action.plan.worldRevision;
          command = { requestId: `forget:${hash(`${action.requestId}|${id}|${revision}`)}`,
            operation: target.kind === 'evidence' ? 'delete_evidence' : 'delete_world_item',
            targetKind: target.kind, targetId: target.id, payload: {}, expectedWorldRevision: revision };
          await update(owner, data => { (data.records[action.requestId].commands ??= {})[id] = command; });
        }
        signal?.throwIfAborted();
        action.commandDispatched = true;
        const result = await m.submitCommand(owner, command);
        const receipt = result.receipt ?? result;
        if (receipt.result_state === 'revision_conflict') return changedScope(Boolean(action.finished?.length));
        if (receipt.result_state === 'rejected') return { state: 'rejected', message: '这次还没能忘掉这条记忆。' };
        if (!['applied', 'no_change'].includes(receipt.result_state)) throw Error('MEMORY_ACTION_PENDING');
        if (receipt.storage_cleanup?.state === 'pending') await update(owner, data => {
          (data.records[action.requestId].cleanupPending ??= []).push(command.requestId);
        });
        await update(owner, data => {
          (data.records[action.requestId].finished ??= []).push(id);
          data.records[action.requestId].plan.nextRevision = receipt.after_revision;
        });
        action.finished ??= []; action.finished.push(id);
        action.plan.nextRevision = receipt.after_revision;
        action.commandDispatched = false;
      }
      // Persist only a generic receipt: the requested topic itself may contain
      // the forgotten value. The current caller can label its transient reply.
      return { state: 'applied', message: '已忘掉这件事。' + retained };
    }
    if (!action.source?.message || typeof action.arguments.sourceQuote !== 'string') return {
      state: 'withheld', message: '这次纠正缺少对应的原话，请重新确认要修改的内容。' };
    if (!await m.correctionSourceSupported?.(owner)) return {
      state: 'unsupported', message: '当前记忆组件不支持核对纠正原话，请更新后再试。' };
    let target = action.arguments;
    if (target.query && !action.target) {
      const snapshot = await m.query(owner, 'preview_recall', { query: target.query, model_tier: action.modelTier ?? 'local' });
      target = (snapshot.preview?.selected_item_ids ?? []).map(([kind, id]) => ({ kind, id }))
        .find(item => ['cognition', 'relationship', 'event'].includes(item.kind));
      if (!target) return notFound();
      await update(owner, data => { data.records[action.requestId].target = target; });
    }
    target = action.target ?? target;
    let command = action.command;
    if (!command) {
      const revision = await m.query(owner, 'query_world', { operation: 'revision' });
      command = { requestId: `correct:${hash(`${action.requestId}|${target.kind}|${target.id}|${revision.world_revision}`)}`,
        operation: 'correct_world_item', targetKind: target.kind, targetId: target.id,
        payload: { correction_text: action.arguments.text, source: { ...action.source.message,
          session_id: action.sessionId, quote: action.arguments.sourceQuote } }, expectedWorldRevision: revision.world_revision };
      await update(owner, data => { data.records[action.requestId].command = command; });
    }
    const result = await m.submitCommand(owner, command);
    const receipt = result.receipt ?? result;
    if (receipt.result_state === 'revision_conflict') await update(owner, data => { delete data.records[action.requestId].command; });
    if (receipt.result_state === 'rejected') {
      const world = await m.query(owner, 'query_world', { operation: 'list', object_kind: target.kind, include_history: true });
      const successor = memorySuccessors(world.items ?? []).resolve(`${target.kind}:${target.id}`);
      if (!successor || successor.current_state !== 'current') return notFound();
      if (successor.item_id !== target.id) await update(owner, data => {
        data.records[action.requestId].target = { kind: target.kind, id: successor.item_id };
        delete data.records[action.requestId].command;
      });
      else return { state: 'rejected', message: '这次还没能更新这条记忆。' };
    }
    if (receipt.result_state !== 'applied') throw Error('MEMORY_ACTION_PENDING');
    return { state: 'applied', message: '已按你刚才的说法更新记忆。', affectedIds: receipt.affected_ids ?? [] };
  }
  function resume(owner) {
    if (flights.has(owner)) return flights.get(owner);
    const work = (async () => {
      const actions = Object.values((await serial(owner, () => read(owner))).records);
      for (const previous of actions.filter(row => !row.result)) {
        const action = (await serial(owner, () => read(owner))).records[previous.requestId];
        if (!action || action.result) continue;
        try {
          const { affectedIds, ...result } = await perform(owner, action, liveSignals.get(`${owner}|${action.requestId}`));
          await update(owner, data => {
            const row = data.records[action.requestId];
            if (row.result) return;
            row.result = result;
            if (affectedIds) row.affectedIds = affectedIds;
            if (row.name === 'memory_correct' && result.state === 'applied') {
              const replaced = new Set([row.arguments.id, row.target?.id, row.command?.targetId, ...(affectedIds ?? [])].filter(Boolean));
              for (const prior of Object.values(data.records)) {
                if (prior === row) break;
                if (prior.result || prior.name !== 'memory_correct') continue;
                if ([prior.arguments.id, prior.target?.id, prior.command?.targetId].some(id => replaced.has(id)) ||
                    row.arguments.query && row.arguments.query === prior.arguments.query) {
                  prior.result = { state: 'superseded', message: '已采用你后来提供的说法。' };
                  prior.arguments = {}; delete prior.source; delete prior.target; delete prior.command;
                }
              }
            }
            // Finished forgetting keeps no body copy in this recovery file.
            if (row.name === 'memory_forget') {
              row.arguments = {}; delete row.source; delete row.plan; delete row.finished; delete row.commands; delete row.scope;
            }
          });
        } catch (error) {
          if (liveSignals.get(`${owner}|${action.requestId}`)?.aborted && !action.commandDispatched) {
            await update(owner, data => {
              const row = data.records[action.requestId];
              row.result = { state: row.finished?.length ? 'partial' : 'cancelled', message: row.finished?.length
                ? '操作已停止；部分记忆已删除，其余没有继续删除。' : '操作已停止，没有删除记忆。' };
              row.arguments = {}; delete row.source; delete row.plan; delete row.scope;
            });
          } else if (['invalid_correction_source', 'invalid_correction_source_quote', 'correction_source_conflict'].includes(error?.code)) {
            await update(owner, data => { data.records[action.requestId].result ??= {
              state: 'rejected', message: '这次纠正的原话不一致，没有修改记忆；请重新确认。' }; });
          } else if (['world_item_not_found', 'evidence_not_found'].includes(error?.code)) {
            await update(owner, data => { data.records[action.requestId].result ??= notFound(); });
          } else schedule(owner);
          // A transient or permanent failure belongs to this request only.
          // Other queued user requests must still get their own attempt.
        }
      }
      const latest = Object.values((await serial(owner, () => read(owner))).records);
      for (const action of latest) for (const requestId of action.cleanupPending ?? []) {
        try {
          const result = await manager().retryCleanupByRequest(owner, requestId);
          if ((result.receipt ?? result).storage_cleanup?.state !== 'pending') await update(owner, data => {
            const row = data.records[action.requestId]; row.cleanupPending = row.cleanupPending.filter(id => id !== requestId);
          });
          else schedule(owner);
        } catch { schedule(owner); }
      }
    })().finally(() => flights.delete(owner));
    flights.set(owner, work); return work;
  }
  return {
    async submit(owner, action) {
      const { signal, ...record } = action;
      const key = `${owner}|${action.requestId}`;
      if (signal) liveSignals.set(key, signal);
      await update(owner, data => { data.records[action.requestId] ??= record; });
      schedule(owner);
      const work = resume(owner);
      let timer;
      try {
        if (signal) {
          await work;
          if (signal.aborted) await update(owner, data => {
            const row = data.records[action.requestId];
            if (!row.result && !row.commands) row.result = { state: 'cancelled', message: '操作已停止，没有删除记忆。' };
          });
        } else await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, action.automatic ? 60000 : 8000); timer.unref?.(); })]);
      }
      finally { clearTimeout(timer); liveSignals.delete(key); }
      const row = (await serial(owner, () => read(owner))).records[action.requestId];
      return row.result ?? { state: 'queued', message: pendingMessage(action.name) };
    },
    resume,
    async redact(owner, { affectedIds = [], sourceTexts = [] }) {
      const forgotten = new Set(affectedIds);
      const includesSource = value => typeof value === 'string' && value.length > 0 &&
        sourceTexts.some(text => text && (value.includes(text) || text.includes(value)));
      await serial(owner, async () => {
        const data = await read(owner); let changed = false;
        for (const row of Object.values(data.records)) {
          if (![row.arguments?.id, row.target?.id, row.command?.targetId, ...(row.affectedIds ?? []), ...(row.plan?.affectedIds ?? [])].some(id => forgotten.has(id)) &&
              ![row.arguments?.text, row.source?.text, row.command?.payload?.correction_text].some(includesSource)) continue;
          changed = true;
          row.arguments = {}; delete row.source; delete row.target; delete row.command;
          if (row.name === 'memory_forget' && row.plan) row.plan.sourceTexts = [];
          else row.result ??= notFound(); // A deleted target cannot be recreated by a queued correction.
        }
        if (changed) await durableWrite(file(owner), data);
      });
    },
    async pending(owner) { return Object.values((await serial(owner, () => read(owner))).records).some(row => !row.result || row.cleanupPending?.length); },
    async clear(owner) {
      await flights.get(owner)?.catch(() => {});
      await serial(owner, () => rm(file(owner), { force: true }));
    },
    async close() { await Promise.allSettled([...flights.values(), ...queues.values()]); },
  };
}
