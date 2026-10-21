import { createHash } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { durableWrite } from '../personal-access/store.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';
import { memorySuccessors } from './world-projection.mjs';
import { forgetCompletionVersion } from './forget-model.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const diagnostics = channel('weftmate.memory.actions');
let nextFlightId = 0;
const safeErrorCodes = new Set(['MEMORY_ACTION_PENDING', 'MEMORY_BUSY', 'MEMORY_PROCESS_UNAVAILABLE',
  'MEMORY_RESPONSE_INVALID', 'MEMORY_TIMEOUT', 'MEMORY_MODEL_UNAVAILABLE', 'PRIVATE_STORAGE_UNAVAILABLE',
  'MEMORY_CLOSING', 'MEMORY_PROTOCOL_ERROR', 'MEMORY_RPC_ERROR', 'MEMORY_RESPONSE_TOO_LARGE',
  'EPERM', 'EACCES', 'ENOENT', 'EBUSY', 'EIO',
  'invalid_correction_source', 'invalid_correction_source_quote', 'correction_source_conflict',
  'world_item_not_found', 'evidence_not_found']);
const errorCode = error => safeErrorCodes.has(error?.code) ? error.code
  : error?.message === 'MEMORY_ACTION_PENDING' ? 'MEMORY_ACTION_PENDING'
  : error?.name === 'AbortError' ? 'ABORT_ERR' : 'UNKNOWN';
const trace = (owner, event, fields) => {
  if (diagnostics.hasSubscribers) diagnostics.publish({ event, ownerId: hash(owner), ...fields });
};
const pendingMessage = name => name === 'memory_forget'
  ? '这次还没忘掉，稍后会再试。' : '这次还没记住，稍后会再试。';
const notFound = () => ({ state: 'not_found', message: '没找到这条记忆。' });
const retiredAction = () => Object.assign(Error('MEMORY_ACTION_RETIRED'), { code: 'MEMORY_ACTION_RETIRED' });
function clearActionBody(row) {
  row.arguments = {};
  for (const key of ['source', 'target', 'command', 'plan', 'scope', 'finished', 'commands']) delete row[key];
}
function scrubForgetReceipt(row) {
  row.arguments = {};
  for (const key of ['source', 'target', 'command', 'scope']) delete row[key];
  if (row.plan) { row.plan.sourceTexts = []; delete row.plan.authorization; delete row.plan.message; }
}
const submittedForget = row => row.name === 'memory_forget' &&
  (Object.keys(row.commands ?? {}).length > 0 || (row.finished?.length ?? 0) > 0);
function retainForgetReceipts(row) {
  scrubForgetReceipt(row);
  row.plan = { ...row.plan, completionVersion: forgetCompletionVersion, completionState: 'withheld', completionUpgraded: true };
  // A later missing target says nothing about earlier submitted commands. Use
  // the existing receipt-only recovery path, never replay to infer an outcome.
  if (row.result?.state === 'not_found') delete row.result;
}
const actionTargets = row => [row.arguments?.id, row.target?.id, row.command?.targetId,
  ...(row.affectedIds ?? []), ...(row.plan?.affectedIds ?? []),
  ...(row.plan?.worldTargets ?? []).map(target => target.id), ...(row.plan?.evidenceIds ?? []),
  ...(row.plan?.authorizedEvidenceIds ?? []), ...Object.values(row.commands ?? {}).map(command => command.targetId)];
const changedScope = partial => ({ state: partial ? 'partial' : 'withheld', message: partial
  ? '部分记忆已删除，但其余内容在确认后发生了变化，没有继续删除；请重新确认。'
  : '记忆在原来确认后发生了变化，这次没有删除；请重新确认要忘掉的内容。' });

/** Durable user intents. Core remains the only authority for facts and receipts. */
export function createMemoryActions({ root, manager, schedule, redactJournal = async () => {} }) {
  const queues = new Map(), flights = new Map();
  // Live request cancellation only; never persisted as another work queue.
  const liveSignals = new Map();
  const file = owner => path.join(root, 'accounts', owner, 'memory-home', 'pending-actions.json');
  const serial = (owner, fn) => {
    const work = (queues.get(owner) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, work.catch(() => {})); return work;
  };
  async function scrubTerminals(owner, data) {
    let changed = false;
    for (const row of Object.values(data.records)) if (row.result?.state === 'not_found' &&
        (Object.keys(row.arguments ?? {}).length || ['source', 'target', 'command', 'plan', 'scope', 'finished', 'commands'].some(key => key in row))) {
      // Keep the old target/source until both existing files have been scrubbed.
      await redactJournal(owner, row);
      if (submittedForget(row)) retainForgetReceipts(row);
      else clearActionBody(row);
      changed = true;
    }
    return changed;
  }
  async function read(owner) {
    try {
      await ensurePrivateFile(file(owner));
      const data = JSON.parse(await readFile(file(owner), 'utf8'));
      // Older hosts could persist a not_found receipt alongside a resurrected
      // command. Honor that existing terminal result on restart, without replay.
      const changed = await scrubTerminals(owner, data);
      if (changed) await durableWrite(file(owner), data);
      return data;
    }
    catch (error) { if (error.code === 'ENOENT') return { records: {} }; throw error; }
  }
  async function update(owner, fn) {
    return serial(owner, async () => {
      await ensurePrivateDirectory(path.dirname(file(owner)));
      const data = await read(owner), result = fn(data);
      await scrubTerminals(owner, data);
      await durableWrite(file(owner), data); return result;
    });
  }
  async function perform(owner, action, signal, recovering, lease) {
    const m = manager();
    const assertActive = () => { if (lease.retired) throw retiredAction(); };
    // Same serialization as redaction: a terminal record cannot accept a late
    // plan/target/command checkpoint from an earlier asynchronous snapshot.
    const save = async fn => {
      let selectedDeleted = false;
      const result = await update(owner, data => {
        assertActive();
        const row = data.records[action.requestId];
        if (!row || row.result) throw retiredAction();
        const result = fn(data);
        // Selection may return an ID that was not yet known when redaction ran.
        // Check it under that same lock, before any plaintext checkpoint is written.
        if (actionTargets(row).some(id => lease.deletedTargets.has(id))) {
          row.result = notFound(); selectedDeleted = true;
        }
        if (lease.scrubbed) scrubForgetReceipt(row);
        return result;
      });
      // update has persisted the terminal, scrubbed record. Do not throw inside
      // its mutation callback and accidentally discard that terminal write.
      if (selectedDeleted) lease.retired = true;
      assertActive();
      return result;
    };
    const submit = async command => {
      assertActive(); lease.commandRequestId = command.requestId;
      try { return await m.submitCommand(owner, command, assertActive); }
      finally { lease.commandRequestId = null; }
    };
    assertActive();
    signal?.throwIfAborted();
    if (action.name === 'memory_forget') {
      if (recovering) {
        // All recovery entrances share this fence, including frozen v2 plans.
        // Reserved/sent identities are receipt-only: never replay a deletion to
        // establish whether it happened, or infer nonexecution from no receipt.
        const dispatched = Object.keys(action.commands ?? {}).length || action.finished?.length;
        let scope;
        if (!dispatched) {
          try { scope = await m.revalidateForget?.(owner, action, signal); }
          catch { signal?.throwIfAborted(); }
        }
        signal?.throwIfAborted();
        assertActive();
        const prior = [action.scope, action.plan?.authorization].filter(Boolean);
        if (dispatched || scope?.authorized !== true || prior.some(value => value.authorized !== true ||
            value.subject !== scope.subject || value.topic !== scope.topic)) {
          // Preserve an existing incomplete proof and its explanation. It
          // already takes the receipt-only path below, including old upgrades.
          if (!dispatched || action.plan?.completionState !== 'withheld') {
            action.plan = { ...action.plan, completionVersion: forgetCompletionVersion, completionState: 'withheld', completionUpgraded: true };
            await save(data => { data.records[action.requestId].plan = action.plan; });
          }
        } else action = { ...action, scope };
      }
      const frozen = action.plan;
      if (frozen && frozen.completionVersion !== forgetCompletionVersion) {
        // Earlier plans lack current completeness or retained-count proof.
        // Upgrade proof only: never replace their commands,
        // targets, authorization or revision with a freshly nominated scope.
        let complete = false, retainedOtherCount;
        if (!Object.keys(action.commands ?? {}).length && !action.finished?.length &&
            frozen.version === 2 && Number.isSafeInteger(frozen.worldRevision) && frozen.authorization?.authorized === true) {
          assertActive();
          const proof = await m.planForget(owner, { ...action, scope: frozen.authorization, signal });
          signal?.throwIfAborted();
          const targets = plan => [...(plan.worldTargets ?? []).map(row => `${row.kind}:${row.id}`),
            ...(plan.evidenceIds ?? []).map(id => `evidence:${id}`)].sort();
          const evidence = new Set(frozen.authorizedEvidenceIds ?? frozen.evidenceIds ?? []);
          complete = proof.completionVersion === forgetCompletionVersion && proof.completionState === 'complete' &&
            proof.worldRevision === frozen.worldRevision && proof.authorization?.subject === frozen.authorization.subject &&
            proof.authorization?.topic === frozen.authorization.topic && JSON.stringify(targets(proof)) === JSON.stringify(targets(frozen)) &&
            (proof.authorizedEvidenceIds ?? proof.evidenceIds ?? []).every(id => evidence.has(id));
          if (complete) retainedOtherCount = proof.retainedOtherCount;
        }
        action.plan = { ...frozen, completionVersion: forgetCompletionVersion, completionState: complete ? 'complete' : 'withheld', completionUpgraded: true,
          ...(complete ? { retainedOtherCount } : {}) };
        await save(data => { data.records[action.requestId].plan = action.plan; });
      }
      // New requests still pass the original whole-message/subject checks.
      if (!action.plan || (action.plan.completionState !== 'withheld' &&
          (action.plan.version !== 2 || !Number.isSafeInteger(action.plan.worldRevision) || action.plan.authorization?.authorized !== true))) {
        const previous = action.plan;
        assertActive();
        const plan = await m.planForget(owner, { ...action, signal });
        signal?.throwIfAborted();
        if (previous) {
          const evidence = new Set(previous.authorizedEvidenceIds ?? previous.evidenceIds ?? []);
          const items = new Set([...(previous.affectedIds ?? []), ...(previous.worldTargets ?? []).map(row => row.id)]);
          if ((plan.authorizedEvidenceIds ?? plan.evidenceIds ?? []).some(id => !evidence.has(id)) ||
              (plan.affectedIds ?? []).some(id => !items.has(id))) return changedScope(Boolean(action.finished?.length));
        }
        await save(data => { data.records[action.requestId].plan = plan; }); action.plan = plan;
      }
      const deletions = [...(action.plan.worldTargets ?? []), ...(action.plan.evidenceIds ?? []).map(id => ({ kind: 'evidence', id }))];
      const retained = (action.plan.retainedOtherCount ? `还有 ${action.plan.retainedOtherCount} 条关于别人的没动。` : '') +
        (action.plan.retainedUncertainCount ? `还有 ${action.plan.retainedUncertainCount} 条归属或共用来源不明确的没动。` : '');
      if (action.plan.retainedUncertainCount > 0 || action.plan.state === 'withheld' || action.plan.completionState === 'withheld') {
        // A completed target is not a completed topic when a known source must
        // remain. Read an existing Core receipt; never replay to prove an effect.
        let applied = false, uncertain = (action.finished ?? []).some(id => !action.commands?.[id]);
        const commands = Object.entries(action.commands ?? {});
        for (const [id, command] of commands) {
          assertActive();
          if (id !== (command.targetKind === 'evidence' ? command.targetId : `${command.targetKind}:${command.targetId}`)) { uncertain = true; continue; }
          try {
            const result = await m.receiptForAction(owner, command);
            const state = (result?.receipt ?? result)?.result_state;
            if (state === 'applied') applied = true;
            else if (!['no_change', 'rejected', 'revision_conflict'].includes(state)) uncertain = true;
          } catch { uncertain = true; }
        }
        if (uncertain) {
          // A reserved/sent old command cannot be called unexecuted just because
          // its receipt is unavailable. Keep the existing uncertainty/recovery
          // identity; recovery only inspects receipts, never dispatches this plan.
          action.commandDispatched = true;
          throw Error('MEMORY_ACTION_PENDING');
        }
        return { state: applied ? 'partial' : 'withheld', message: applied
          ? action.plan.completionUpgraded
            ? '原请求已执行，但还不能确认完全忘掉，本次没有继续删除。原聊天保留。'
            : '部分记忆已删除，但仍不能确认已完全忘掉；包含其他独立内容的来源保留，没有继续删除。原聊天保留。'
          : commands.length ? '原请求已核对，本次没有继续删除；仍未完整忘掉。独立记忆和原聊天保留。'
            : action.plan.completionUpgraded ? '尚不能确认完整遗忘范围，这次没有执行遗忘；请重新确认要忘掉的内容。独立记忆和原聊天保留。'
              : action.plan.message ?? '这次没有执行遗忘：相关来源还包含需要保留的其他内容，尚不能完整忘掉。独立记忆和原聊天保留。' };
      }
      if (!deletions.length) return action.plan.state ? { state: action.plan.state, message: action.plan.message }
        : retained ? { state: 'withheld', message: '这次没有删除记忆。' + retained } : notFound();
      if (!Number.isSafeInteger(action.plan.nextRevision ?? action.plan.worldRevision)) return changedScope(Boolean(action.finished?.length));
      // One frozen batch preview is one command and one actual Core receipt.
      // Older saved plans keep their original identities and scope fences.
      for (const target of action.plan.batchForget ? deletions.slice(0, 1) : deletions) {
        assertActive();
        signal?.throwIfAborted();
        const id = target.kind === 'evidence' ? target.id : `${target.kind}:${target.id}`;
        if (action.finished?.includes(id)) continue;
        let command = action.commands?.[id];
        if (!command) {
          const revision = action.plan.nextRevision ?? action.plan.worldRevision;
          command = { requestId: `forget:${hash(`${action.requestId}|${id}|${revision}`)}`,
            operation: target.kind === 'evidence' ? 'delete_evidence' : 'delete_world_item',
            targetKind: target.kind, targetId: target.id,
            payload: action.plan.batchForget ?? (typeof action.plan.forgetScopes?.[`${target.kind}:${target.id}`] === 'string'
              ? { forget_scope: action.plan.forgetScopes[`${target.kind}:${target.id}`] } : {}), expectedWorldRevision: revision };
          await save(data => { (data.records[action.requestId].commands ??= {})[id] = command; });
        }
        signal?.throwIfAborted();
        action.commandDispatched = true;
        const result = await submit(command);
        const receipt = result.receipt ?? result;
        if (receipt.result_state === 'revision_conflict' || ['forget_scope_changed', 'forget_scope_required'].includes(receipt.rejection_code)) return changedScope(Boolean(action.finished?.length));
        if (receipt.result_state === 'rejected') return { state: 'rejected', message: '这次还没能忘掉这条记忆。' };
        if (!['applied', 'no_change'].includes(receipt.result_state)) throw Error('MEMORY_ACTION_PENDING');
        if (receipt.storage_cleanup?.state === 'pending') await save(data => {
          (data.records[action.requestId].cleanupPending ??= []).push(command.requestId);
        });
        await save(data => {
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
    assertActive();
    let target = action.arguments;
    if (target.query && !action.target) {
      const snapshot = await m.query(owner, 'preview_recall', { query: target.query, model_tier: action.modelTier ?? 'local' });
      target = (snapshot.preview?.selected_item_ids ?? []).map(([kind, id]) => ({ kind, id }))
        .find(item => ['cognition', 'relationship', 'event'].includes(item.kind));
      if (!target) return notFound();
      await save(data => { data.records[action.requestId].target = target; });
    }
    target = action.target ?? target;
    let command = action.command;
    if (!command) {
      assertActive();
      const revision = await m.query(owner, 'query_world', { operation: 'revision' });
      command = { requestId: `correct:${hash(`${action.requestId}|${target.kind}|${target.id}|${revision.world_revision}`)}`,
        operation: 'correct_world_item', targetKind: target.kind, targetId: target.id,
        payload: { correction_text: action.arguments.text, source: { ...action.source.message,
          session_id: action.sessionId, quote: action.arguments.sourceQuote } }, expectedWorldRevision: revision.world_revision };
      await save(data => { data.records[action.requestId].command = command; });
    }
    const result = await submit(command);
    const receipt = result.receipt ?? result;
    if (receipt.result_state === 'revision_conflict') await save(data => { delete data.records[action.requestId].command; });
    if (receipt.result_state === 'rejected') {
      assertActive();
      const world = await m.query(owner, 'query_world', { operation: 'list', object_kind: target.kind, include_history: true });
      const successor = memorySuccessors(world.items ?? []).resolve(`${target.kind}:${target.id}`);
      if (!successor || successor.current_state !== 'current') return notFound();
      if (successor.item_id !== target.id) await save(data => {
        data.records[action.requestId].target = { kind: target.kind, id: successor.item_id };
        delete data.records[action.requestId].command;
      });
      else return { state: 'rejected', message: '这次还没能更新这条记忆。' };
    }
    if (receipt.result_state !== 'applied') throw Error('MEMORY_ACTION_PENDING');
    return { state: 'applied', message: '已按你刚才的说法更新记忆。', affectedIds: receipt.affected_ids ?? [] };
  }
  function resume(owner, submittedRequestId = null) {
    const active = flights.get(owner);
    if (active) {
      if (submittedRequestId) active.submitted.add(submittedRequestId);
      trace(owner, 'flight-joined', { flightId: active.id,
        requestId: submittedRequestId ? hash(submittedRequestId) : null,
        snapshotIncludesRequest: submittedRequestId ? active.snapshot?.has(submittedRequestId) ?? null : null });
      return active.work;
    }
    const flight = { id: ++nextFlightId, submitted: new Set(submittedRequestId ? [submittedRequestId] : []),
      attempted: new Set(), cleanupAttempted: new Set(), snapshot: null, work: null };
    const work = (async () => {
      let actions = Object.values((await serial(owner, () => read(owner))).records);
      while (true) {
        flight.snapshot = new Set(actions.map(row => row.requestId));
        trace(owner, 'flight-snapshot', { flightId: flight.id, requestIds: [...flight.snapshot].map(hash) });
        for (const previous of actions.filter(row => !row.result)) {
          const lease = { requestId: previous.requestId, retired: false, commandRequestId: null, deletedTargets: new Set() };
          const action = await serial(owner, async () => {
            const row = (await read(owner)).records[previous.requestId];
            if (!row || row.result || flight.attempted.has(row.requestId)) return null;
            // Publish the live attempt under the same lock as its snapshot, so
            // redaction cannot miss it between reading and beginning execution.
            flight.current = lease;
            return row;
          });
          if (!action) continue;
          flight.attempted.add(action.requestId);
          trace(owner, 'perform-enter', { flightId: flight.id, requestId: hash(action.requestId) });
          try {
            const { affectedIds, ...result } = await perform(owner, action, liveSignals.get(`${owner}|${action.requestId}`),
              !flight.submitted.has(action.requestId), lease);
            await update(owner, data => {
              const row = data.records[action.requestId];
              if (row.result || lease.retired) return;
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
                if (submittedForget(row)) scrubForgetReceipt(row);
                else clearActionBody(row);
              }
            });
            trace(owner, 'perform-return', { flightId: flight.id, requestId: hash(action.requestId) });
          } catch (error) {
            if (lease.retired || error?.code === 'MEMORY_ACTION_RETIRED') continue;
            trace(owner, 'perform-error', { flightId: flight.id, requestId: hash(action.requestId), errorCode: errorCode(error) });
            if (liveSignals.get(`${owner}|${action.requestId}`)?.aborted && !action.commandDispatched) {
              await update(owner, data => {
                const row = data.records[action.requestId];
                if (!row || row.result) return;
                row.result = { state: row.finished?.length ? 'partial' : 'cancelled', message: row.finished?.length
                  ? '操作已停止；部分记忆已删除，其余没有继续删除。' : '操作已停止，没有删除记忆。' };
                row.arguments = {}; delete row.source; delete row.plan; delete row.scope;
              });
            } else if (['invalid_correction_source', 'invalid_correction_source_quote', 'correction_source_conflict'].includes(error?.code)) {
              await update(owner, data => { data.records[action.requestId].result ??= {
                state: 'rejected', message: '这次纠正的原话不一致，没有修改记忆；请重新确认。' }; });
            } else if (['world_item_not_found', 'evidence_not_found'].includes(error?.code)) {
              const needsReceipt = await update(owner, data => {
                const row = data.records[action.requestId]; row.result ??= notFound(); return submittedForget(row);
              });
              if (needsReceipt) schedule(owner);
            } else schedule(owner);
            // A transient or permanent failure belongs to this request only.
            // Other queued user requests must still get their own attempt.
          } finally { if (flight.current === lease) flight.current = null; }
        }
        const latest = Object.values((await serial(owner, () => read(owner))).records);
        for (const action of latest) for (const requestId of action.cleanupPending ?? []) {
          const cleanupKey = `${action.requestId}|${requestId}`;
          if (flight.cleanupAttempted.has(cleanupKey)) continue;
          flight.cleanupAttempted.add(cleanupKey);
          try {
            const result = await manager().retryCleanupByRequest(owner, requestId);
            const receipt = result?.receipt ?? result, cleanup = receipt?.storage_cleanup;
            // This manager method also verifies the host journal cleanup. Core
            // no_change makes no physical deletion and may omit its cleanup field.
            const complete = receipt?.result_state === 'applied' && cleanup?.state === 'complete' ||
              receipt?.result_state === 'no_change' && (cleanup === undefined || cleanup?.state === 'complete');
            if (complete) await update(owner, data => {
              const row = data.records[action.requestId]; row.cleanupPending = row.cleanupPending.filter(id => id !== requestId);
            });
            else schedule(owner);
          } catch { schedule(owner); }
        }
        // Only newly submitted work that this flight has not attempted is drained.
        // Failed requests and cleanup keep their existing scheduled retry cadence.
        // Withdraw the flight in this same serial section: a later persistence
        // cannot join a snapshot that has already decided to finish.
        actions = await serial(owner, async () => {
          const records = Object.values((await read(owner)).records);
          const next = records.filter(row => flight.submitted.has(row.requestId) && !row.result && !flight.attempted.has(row.requestId));
          if (!next.length && flights.get(owner) === flight) flights.delete(owner);
          return next;
        });
        if (!actions.length) break;
      }
    })().finally(() => {
      if (flights.get(owner) === flight) flights.delete(owner);
      trace(owner, 'flight-finished', { flightId: flight.id, attemptedRequestIds: [...flight.attempted].map(hash) });
    });
    flight.work = work;
    flights.set(owner, flight);
    trace(owner, 'flight-started', { flightId: flight.id });
    return work;
  }
  return {
    async submit(owner, action) {
      const started = performance.now();
      const { signal, ...record } = action;
      const key = `${owner}|${action.requestId}`;
      if (signal) liveSignals.set(key, signal);
      const created = await update(owner, data => {
        if (data.records[action.requestId]) return false;
        data.records[action.requestId] = record; return true;
      });
      trace(owner, 'submit-persisted', { requestId: hash(action.requestId), created,
        activeFlightId: flights.get(owner)?.id ?? null });
      schedule(owner);
      const work = resume(owner, created ? action.requestId : undefined);
      const flight = flights.get(owner);
      let timer, budgetExpired = false;
      try {
        if (signal) {
          await work;
          if (signal.aborted) await update(owner, data => {
            const row = data.records[action.requestId];
            if (!row.result && !row.commands) row.result = { state: 'cancelled', message: '操作已停止，没有删除记忆。' };
          });
        } else await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => {
          budgetExpired = true; resolve();
        }, action.automatic ? 60000 : 8000); timer.unref?.(); })]);
      }
      finally { clearTimeout(timer); liveSignals.delete(key); }
      const row = (await serial(owner, () => read(owner))).records[action.requestId];
      trace(owner, 'submit-return', { requestId: hash(action.requestId), flightId: flight?.id ?? null,
        attempted: flight?.attempted.has(action.requestId) ?? false, elapsedMs: Math.round(performance.now() - started),
        reason: budgetExpired ? action.automatic ? '60s-budget' : '8s-budget'
          : row.result ? 'flight-settled-with-result' : 'flight-settled-still-pending', recoveryRequested: true });
      const incomplete = row.name === 'memory_forget' && (row.plan?.retainedUncertainCount > 0 || row.plan?.state === 'withheld' || row.plan?.completionState === 'withheld');
      // Keep the durable applied result as the no-replay barrier, but do not
      // expose completion until every original cleanup request has finished.
      if (row.name === 'memory_forget' && row.result?.state === 'applied' && row.cleanupPending?.length)
        return { state: 'queued', message: '删除已执行，相关记录还在清理，暂时还没全部忘完。' };
      return row.result ?? { state: 'queued', message: incomplete
        ? '上次遗忘结果还未能确认，本次没有继续删除；稍后只核对原请求结果。' : pendingMessage(action.name) };
    },
    resume,
    async redact(owner, { affectedIds = [], sourceTexts = [], sessionId = null, completedRequestId = null }) {
      const forgotten = new Set(affectedIds);
      const includesSource = value => typeof value === 'string' && value.length > 0 &&
        sourceTexts.some(text => text && (value.includes(text) || text.includes(value)));
      let needsReceipt = false;
      await serial(owner, async () => {
        const data = await read(owner); let changed = false;
        const lease = flights.get(owner)?.current;
        let ownsCompletion = false;
        for (const row of Object.values(data.records)) {
          if (!(sessionId && row.sessionId === sessionId) &&
              !actionTargets(row).some(id => forgotten.has(id)) &&
              ![row.arguments?.text, row.arguments?.query, row.source?.text, row.source?.message?.content,
                row.command?.payload?.correction_text, ...(row.plan?.sourceTexts ?? [])].some(includesSource)) continue;
          changed = true;
          row.arguments = {}; delete row.source; delete row.target; delete row.command;
          delete row.scope;
          // The deletion whose receipt invoked this cleanup still owns its
          // receipt bookkeeping. Other pending actions are terminal immediately.
          const completing = row.name === 'memory_forget' && completedRequestId &&
            (lease?.requestId === row.requestId && lease.commandRequestId === completedRequestId ||
              Object.values(row.commands ?? {}).some(command => command.requestId === completedRequestId));
          if (completing && row.plan) {
            scrubForgetReceipt(row);
            if (lease?.requestId === row.requestId) { lease.scrubbed = true; ownsCompletion = true; }
          } else {
            row.result ??= notFound();
            if (submittedForget(row)) { retainForgetReceipts(row); needsReceipt ||= !row.result; }
            else clearActionBody(row);
            if (lease?.requestId === row.requestId) lease.retired = true;
          }
        }
        // This bounded, live-attempt set contains IDs only and dies with the
        // existing flight. It also covers selections not yet saved in any row.
        // The operation's own deletion receipt must still finish its bookkeeping.
        if (lease && !ownsCompletion) for (const id of forgotten) lease.deletedTargets.add(id);
        if (changed) await durableWrite(file(owner), data);
      });
      if (needsReceipt) schedule(owner);
    },
    async pending(owner) { return Object.values((await serial(owner, () => read(owner))).records).some(row => !row.result || row.cleanupPending?.length); },
    async clear(owner) {
      await flights.get(owner)?.work.catch(() => {});
      await serial(owner, () => rm(file(owner), { force: true }));
    },
    async close() {
      do { await Promise.allSettled([...flights.values()].map(flight => flight.work).concat([...queues.values()])); }
      while (flights.size);
    },
  };
}
