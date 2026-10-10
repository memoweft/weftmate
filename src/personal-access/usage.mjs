/** Numeric-only, owner-scoped request ledger. Never persist prompts or responses. */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { durableWrite } from './store.mjs';
import { failure } from './common.mjs';

export const MIMO_PRICE = Object.freeze({ cachedInput: 0.02, input: 1, output: 2 });
const zeroPrice = { cachedInput: 0, input: 0, output: 0 };
const count = value => Number.isSafeInteger(value) && value >= 0;
export function normalizeUsage(value, source = 'openai') {
  if (!value || typeof value !== 'object') return null;
  if (source === 'dsh') {
    const { inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 } = value;
    if (![inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].every(count)) return null;
    // pi-ai input excludes cache read/write. Its synthetic all-zero terminal usage
    // cannot prove that a provider reported usage; retain unknown in that case.
    if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
    return { inputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
      cachedInputTokens: cacheReadTokens, outputTokens };
  }
  const inputTokens = value.prompt_tokens ?? value.input_tokens;
  const outputTokens = value.completion_tokens ?? value.output_tokens;
  const cachedInputTokens = value.prompt_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens ??
    value.input_tokens_details?.cached_tokens ?? 0;
  if (![inputTokens, outputTokens, cachedInputTokens].every(count) || cachedInputTokens > inputTokens) return null;
  return { inputTokens, cachedInputTokens, outputTokens };
}
export function usageCost(tokens, price) {
  if (!tokens || !price) return null;
  return Math.round(((tokens.inputTokens - tokens.cachedInputTokens) * price.input +
    tokens.cachedInputTokens * price.cachedInput + tokens.outputTokens * price.output) * 1000) / 1e9;
}
export function defaultUsagePrice(model) {
  if (model?.sourceKind === 'local' || model?.modelTier === 'local') return { ...zeroPrice };
  return model?.model === 'mimo-v2.6-flash' ? { ...MIMO_PRICE } : null;
}
function usageTimeZone(value = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (typeof value !== 'string' || !value || /^[+-]/.test(value)) throw failure('INVALID_REQUEST');
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw failure('INVALID_REQUEST'); }
}
function dateInZone(timeZone) {
  const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return value => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}
export function aggregateUsage(records, month, sessionId = null, timeZone = usageTimeZone()) {
  timeZone = usageTimeZone(timeZone);
  const localDate = dateInZone(timeZone);
  const total = () => ({ requests: 0, unknownRequests: 0, unpricedRequests: 0,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0 });
  const sum = total(), days = new Map(), sessions = new Map(), models = new Map(), categories = new Map();
  const numberOfDays = new Date(`${month}-01T00:00:00Z`); numberOfDays.setUTCMonth(numberOfDays.getUTCMonth() + 1, 0);
  for (let day = 1; day <= numberOfDays.getUTCDate(); day++) days.set(`${month}-${String(day).padStart(2, '0')}`, total());
  function add(target, row) {
    target.requests++;
    if (!row.tokens) target.unknownRequests++;
    else for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens']) target[key] += row.tokens[key];
    if (row.cost === null) target.unpricedRequests++;
    else target.cost = Math.round((target.cost + row.cost) * 1e9) / 1e9;
  }
  for (const row of records) {
    if (sessionId && row.sessionId !== sessionId) continue;
    const day = localDate(row.at), session = row.sessionId;
    if (!day.startsWith(`${month}-`)) continue;
    if (!sessions.has(session)) sessions.set(session, total());
    if (!models.has(row.profileId)) models.set(row.profileId, total());
    const category = row.category ?? 'conversation';
    if (!categories.has(category)) categories.set(category, total());
    add(categories.get(category), row);
    add(sum, row); add(days.get(day), row); add(sessions.get(session), row); add(models.get(row.profileId), row);
  }
  const rank = (map, key) => [...map].map(([id, value]) => ({ [key]: id, ...value })).sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  return { month, timeZone, sessionId, total: sum,
    days: [...days].map(([day, value]) => ({ day, ...value })),
    sessions: rank(sessions, 'sessionId'), models: rank(models, 'profileId'), categories: rank(categories, 'category') };
}
export function usageBudget(cost, settings, month) {
  const limit = settings.temporaryMonth === month && settings.temporaryLimit !== null
    ? settings.temporaryLimit : settings.monthlyLimit;
  return { monthlyLimit: settings.monthlyLimit, effectiveLimit: limit,
    temporaryLimit: settings.temporaryMonth === month ? settings.temporaryLimit : null,
    state: limit === null ? 'unlimited' : cost >= limit ? 'blocked' : cost >= Math.round(limit * 0.8 * 1e9) / 1e9 ? 'warning' : 'ok' };
}
export async function createUsageStore({ root, clock = Date.now }) {
  const file = path.join(root, 'usage.json');
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw failure('STORE_CORRUPT', 500); data = { version: 1, accounts: {} }; }
  if (data.version !== 1 || !data.accounts || typeof data.accounts !== 'object') throw failure('STORE_CORRUPT', 500);
  let queue = Promise.resolve();
  const at = () => new Date(clock()).toISOString();
  const month = timeZone => dateInZone(timeZone)(clock()).slice(0, 7);
  const empty = () => ({ records: [], settings: { monthlyLimit: null, temporaryLimit: null, temporaryMonth: null, prices: {} } });
  const account = ownerId => data.accounts[ownerId] ?? empty();
  const settings = ownerId => ({ ...structuredClone(account(ownerId).settings), timeZone: usageTimeZone(account(ownerId).settings.timeZone) });
  function mutate(ownerId, work) {
    const operation = queue.then(async () => {
      const next = structuredClone(data), row = next.accounts[ownerId] ??= empty();
      const result = work(row); await durableWrite(file, next); data = next; return result;
    });
    queue = operation.catch(() => {}); return operation;
  }
  function summary(ownerId, selectedMonth, sessionId = null, timeZone) {
    const saved = settings(ownerId);
    timeZone = usageTimeZone(timeZone);
    selectedMonth ??= month(timeZone);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) throw failure('INVALID_REQUEST');
    const row = account(ownerId), value = aggregateUsage(row.records, selectedMonth, sessionId, timeZone);
    const budgetMonth = month(saved.timeZone);
    const full = !sessionId && selectedMonth === budgetMonth && timeZone === saved.timeZone
      ? value.total : aggregateUsage(row.records, budgetMonth, null, saved.timeZone).total;
    return { ...value, budget: usageBudget(full.cost, saved, budgetMonth) };
  }
  function assertAllowed(ownerId, model) {
    if (model.sourceKind !== 'local' && model.modelTier !== 'local' && summary(ownerId).budget.state === 'blocked') {
      throw failure('USAGE_LIMIT_REACHED', 402);
    }
  }
  return {
    exportAccount: ownerId => structuredClone(account(ownerId)),
    eraseAccount(ownerId) {
      const operation = queue.then(async () => { const next = structuredClone(data); delete next.accounts[ownerId]; await durableWrite(file, next); data = next; });
      queue = operation.catch(() => {}); return operation;
    },
    summary,
    settings,
    async configure(ownerId, input) {
      const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
      const allowed = ['monthlyLimit', 'temporaryLimit', 'profileId', 'price', 'timeZone'];
      if (!input || Object.keys(input).some(key => !allowed.includes(key)) || !Object.keys(input).length) throw failure('INVALID_REQUEST');
      for (const key of ['monthlyLimit', 'temporaryLimit']) if (Object.hasOwn(input, key) && input[key] !== null && !money(input[key])) throw failure('INVALID_REQUEST');
      if (Object.hasOwn(input, 'price') !== Object.hasOwn(input, 'profileId')) throw failure('INVALID_REQUEST');
      if (Object.hasOwn(input, 'profileId') && (typeof input.profileId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.profileId))) throw failure('INVALID_REQUEST');
      if (input.price !== undefined && input.price !== null &&
        (Object.keys(input.price).length !== 3 || !['cachedInput', 'input', 'output'].every(key => money(input.price[key])))) throw failure('INVALID_REQUEST');
      const timeZone = Object.hasOwn(input, 'timeZone') ? usageTimeZone(input.timeZone) : null;
      await mutate(ownerId, row => {
        if (timeZone) row.settings.timeZone = timeZone;
        for (const key of ['monthlyLimit', 'temporaryLimit']) if (Object.hasOwn(input, key)) row.settings[key] = input[key];
        if (Object.hasOwn(input, 'temporaryLimit')) row.settings.temporaryMonth = month(usageTimeZone(row.settings.timeZone));
        if (input.profileId) { if (input.price === null) delete row.settings.prices[input.profileId]; else row.settings.prices[input.profileId] = input.price; }
      });
      return this.settings(ownerId);
    },
    assertAllowed,
    async begin(ownerId, { sessionId = null, profileId, model, category = 'conversation' }) {
      return mutate(ownerId, row => {
        if (!model) throw failure('MODEL_UNAVAILABLE', 409);
        assertAllowed(ownerId, model);
        const requestId = randomUUID();
        const price = row.settings.prices[profileId] ?? defaultUsagePrice(model);
        row.records.push({ requestId, sessionId, profileId, category, at: at(), durationMs: null,
          tokens: null, cost: null, price, source: 'unknown' });
        return requestId;
      });
    },
    async finish(ownerId, requestId, usage, source = 'openai') {
      await mutate(ownerId, row => {
        const record = row.records.find(item => item.requestId === requestId);
        if (!record || record.durationMs !== null) return;
        record.tokens = normalizeUsage(usage, source);
        record.cost = record.tokens ? usageCost(record.tokens, record.price) : null;
        record.source = record.tokens ? source : 'unknown';
        record.durationMs = Math.max(0, clock() - Date.parse(record.at));
      });
    },
    close: () => queue,
  };
}
