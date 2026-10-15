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

/** Durable user intents. Core remains the only authority for facts and receipts. */
export function createMemoryActions({ root, manager, schedule }) {
  const queues = new Map(), flights = new Map();
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
  async function forgetSources(owner, action) {
    const m = manager(), args = action.arguments;
    let targets;
    const worlds = new Map();
    if (args.query) {
      // Conversational recall also adds identity and standing style preferences.
      // A destructive topic lookup must use only this one Core query.
      const snapshot = await m.query(owner, 'preview_recall', { query: args.query, model_tier: action.modelTier ?? 'local' });
      targets = (snapshot.preview?.selected_item_ids ?? []).map(([kind, id]) => ({ kind, id }));
      targets.push(...[...(snapshot.preview?.recent_evidence ?? []), ...(snapshot.preview?.pending_corrections ?? [])]
        .map(item => ({ id: item.id ?? item.evidence_id, kind: 'evidence' })));
      // Recall deliberately omits invalidated items. A deletion must also find
      // literal topic matches in the owner's retained history, without sending
      // that unrestricted history to the model or guessing semantic synonyms.
      const topic = args.query.normalize('NFKC').trim().replace(/^(?:关于|我的?|用户的?)/u, '')
        .replace(/(?:的)?记忆$/u, '').replaceAll('的', '').trim();
      if (topic) for (const kind of ['cognition', 'relationship', 'event', 'entity']) {
        const world = await m.query(owner, 'query_world', { operation: 'list', object_kind: kind, include_history: true });
        worlds.set(kind, world);
        for (const row of world.items ?? []) {
          const content = row.value.content ?? row.value.canonical_name ?? '';
          if (content.normalize('NFKC').replaceAll('的', '').includes(topic)) targets.push({ kind, id: row.item_id });
        }
      }
    } else targets = [{ kind: args.kind, id: args.id }];
    const ids = new Set(), sources = new Set(), texts = new Set();
    const related = new Set(targets.map(item => item.id));
    // Capture the entire revision chain before deleting its first source: Core
    // removes transition links during deletion, so walking afterward is too late.
    for (const kind of new Set(targets.filter(item => item.kind !== 'evidence').map(item => item.kind))) {
      const world = worlds.get(kind) ?? await m.query(owner, 'query_world', { operation: 'list', object_kind: kind, include_history: true });
      let changed;
      do {
        changed = false;
        for (const row of world.items ?? []) for (const link of row.transition_history ?? []) {
          if (related.has(link.prior_item_id) || related.has(link.replacement_item_id)) {
            for (const id of [link.prior_item_id, link.replacement_item_id]) if (id && !related.has(id)) { related.add(id); changed = true; }
          }
        }
      } while (changed);
      for (const row of world.items ?? []) if (related.has(row.item_id)) {
        ids.add(row.item_id);
        const result = await m.query(owner, 'query_provenance', { object_kind: kind, item_id: row.item_id, projection: 'history' });
        for (const source of result.provenance ?? []) {
          sources.add(source.evidence_id); if (source.evidence.raw_content) texts.add(source.evidence.raw_content);
        }
      }
    }
    for (const target of targets) if (target.kind === 'evidence') sources.add(target.id);
    // A successful explicit correction and its turn's later background capture
    // used to create two independent sources. Include that still-provisional
    // original utterance too, rather than relying on another model tool call.
    const records = Object.values((await serial(owner, () => read(owner))).records);
    for (const row of records) if (related.has(row.arguments.id) && row.source?.text) texts.add(row.source.text);
    for (const text of texts) {
      const snapshot = await m.query(owner, 'preview_recall', { query: text.slice(0, 500), model_tier: action.modelTier ?? 'local' });
      for (const item of [...(snapshot.preview?.recent_evidence ?? []), ...(snapshot.preview?.pending_corrections ?? [])]) {
        // Core supplies permission-filtered related source candidates. Questions
        // and unrelated quotes must not expand an exact-id deletion.
        if (texts.has(item.text) || /纠正|不对|不是|改为|改成/.test(item.text ?? '')) sources.add(item.id ?? item.evidence_id);
      }
    }
    // Core's world-item delete owns entity cascades, including relationships
    // and cognitions whose implicitly-created person has no direct ledger.
    const worldTargets = targets.filter(item => item.kind === 'entity');
    return { evidenceIds: [...sources], worldTargets, affectedIds: [...ids], sourceTexts: [...texts] };
  }
  async function perform(owner, action) {
    const m = manager();
    if (action.name === 'memory_forget') {
      if (!action.plan) {
        const plan = await forgetSources(owner, action);
        await update(owner, data => { data.records[action.requestId].plan = plan; }); action.plan = plan;
      }
      const deletions = [...(action.plan.worldTargets ?? []), ...action.plan.evidenceIds.map(id => ({ kind: 'evidence', id }))];
      if (!deletions.length) return notFound();
      for (const target of deletions) {
        const id = target.kind === 'evidence' ? target.id : `${target.kind}:${target.id}`;
        if (action.finished?.includes(id)) continue;
        let command = action.commands?.[id];
        if (!command) {
          const revision = await m.query(owner, 'query_world', { operation: 'revision' });
          command = { requestId: `forget:${hash(`${action.requestId}|${id}|${revision.world_revision}`)}`,
            operation: target.kind === 'evidence' ? 'delete_evidence' : 'delete_world_item',
            targetKind: target.kind, targetId: target.id, payload: {}, expectedWorldRevision: revision.world_revision };
          await update(owner, data => { (data.records[action.requestId].commands ??= {})[id] = command; });
        }
        const result = await m.submitCommand(owner, command);
        const receipt = result.receipt ?? result;
        if (receipt.result_state === 'revision_conflict') await update(owner, data => { delete data.records[action.requestId].commands[id]; });
        if (receipt.result_state === 'rejected') return { state: 'rejected', message: '这次还没能忘掉这条记忆。' };
        if (!['applied', 'no_change'].includes(receipt.result_state)) throw Error('MEMORY_ACTION_PENDING');
        if (receipt.storage_cleanup?.state === 'pending') await update(owner, data => {
          (data.records[action.requestId].cleanupPending ??= []).push(command.requestId);
        });
        await update(owner, data => { (data.records[action.requestId].finished ??= []).push(id); });
        action.finished ??= []; action.finished.push(id);
      }
      return { state: 'applied', message: '已忘掉这件事。' };
    }
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
        payload: { correction_text: action.arguments.text }, expectedWorldRevision: revision.world_revision };
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
          const { affectedIds, ...result } = await perform(owner, action);
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
              row.arguments = {}; delete row.source; delete row.plan; delete row.finished; delete row.commands;
            }
          });
        } catch (error) {
          if (['world_item_not_found', 'evidence_not_found'].includes(error?.code)) {
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
      await update(owner, data => { data.records[action.requestId] ??= action; });
      schedule(owner);
      const work = resume(owner);
      let timer;
      try { await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, 8000); timer.unref?.(); })]); }
      finally { clearTimeout(timer); }
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
