/** Native goal service adapter. Only request receipts are stored here; goals live in DSH logs. */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export async function createNativeGoalManager({ ctx, foldGoal, file }) {
  let operations = {};
  try { operations = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let queue = Promise.resolve();
  const save = async () => { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(operations)); await rename(temp, file); };
  const service = agent => ctx.get('agentPresets')?.serviceFor(agent, 'goals') ?? ctx.get('goals');
  async function manage(agent, input) {
    if (input.action === 'list') { const value = foldGoal(agent.session.events); return { goal: value.goal ? { ...value.goal, roundsStarted: value.roundsStarted, createdAt: value.createdAt, updatedAt: value.updatedAt } : null }; }
    const work = queue.then(async () => {
      const key = `${agent.id}:${input.requestId}`, fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex'), prior = operations[key];
      if (prior) { if (fingerprint !== prior.fingerprint) throw Object.assign(new Error('REQUEST_CONFLICT'), { status: 409 }); if (prior.result?.erased) throw Object.assign(new Error('SOURCE_UNAVAILABLE'), {status:404}); return prior.result; }
      const goals = service(agent); if (!goals) throw new Error('CAPABILITY_UNAVAILABLE');
      let result;
      if (input.action === 'erase' || input.action === 'forget') {
        const goal = goals.get(agent), erased = new Set();
        for (const event of agent.session.events) if (event.type === 'goal/change' && event.data?.goal) {
          const past = event.data.goal, source = operations[`${agent.id}:source:${past.id}`];
          if (input.action === 'erase' || input.receiptIds?.includes(source?.receiptId) || input.sourceTexts?.some(text => text && past.objective.includes(text))) erased.add(past.id);
        }
        if (goal && (input.action === 'erase' || input.sourceTexts?.some(text=>text && goal.objective.includes(text)))) erased.add(goal.id);
        if (goal && erased.has(goal.id)) goals.clear(agent, { id: goal.id, revision: goal.revision });
        for (const [id, operation] of Object.entries(operations)) if (id.startsWith(`${agent.id}:`)) {
          if (input.action === 'erase') delete operations[id];
          else if (erased.has(operation.result?.ref?.id)) operation.result = {erased:true};
          else if ([...erased].some(goalId=>id===`${agent.id}:source:${goalId}`)) delete operations[id];
        }
        result = { cleared: !goal || erased.has(goal.id), clearedGoalIds: [...erased] };
      } else if (input.action === 'create') result = { goal: goals.create(agent, { objective: input.objective }) };
      else if (input.action === 'complete') result = { goal: goals.complete(agent, input.ref) };
      else if (input.action === 'archive') result = { ref: goals.clear(agent, input.ref), archived: true };
      else throw Object.assign(new Error('INVALID_REQUEST'), { status: 400 });
      await ctx.sessions.flush(agent.session);
      // Keep only references in receipts, so erased/temporary objectives never leak here.
      if (result.goal) result = { ref: { id: result.goal.id, revision: result.goal.revision } };
      if (!['erase','forget'].includes(input.action)) operations[key] = { fingerprint, result };
      await save(); return result;
    }); queue = work.catch(() => {}); return work;
  }
  async function register(agent, receiptId) {
    const work = queue.then(async () => { const goal = service(agent)?.get(agent); if (goal) { operations[`${agent.id}:source:${goal.id}`] = { receiptId }; await save(); } }); queue = work.catch(() => {}); return work;
  }
  return { manage, register, close: () => queue };
}
