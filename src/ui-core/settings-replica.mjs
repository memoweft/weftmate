import './personalization.js';
const spec = globalThis.WeftPersonalization;
const invalid = () => Object.assign(new Error('SETTINGS_SYNC_INVALID'), {code:'SETTINGS_SYNC_INVALID',status:400});
export function newer(a,b) {
  return a.at > b.at || a.at === b.at && a.id > b.id;
}
export function mergeSettings(base, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw invalid();
  const values = Object.fromEntries(Object.entries(changes).map(([key,row])=>[key,row?.value]));
  if (Object.keys(values).length) spec.validate(values);
  const result = {...base};
  for (const [key,row] of Object.entries(changes)) {
    if (!row || Object.keys(row).sort().join() !== 'at,id,value' ||
        !Number.isSafeInteger(row.at) || row.at < 0 || row.at > 8640000000000000 ||
        typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{0,64}$/.test(row.id)) throw invalid();
    const prior = result[key];
    if (prior && prior.at === row.at && prior.id === row.id && prior.value !== row.value) throw invalid();
    if (!prior || newer(row,prior)) result[key] = row;
  }
  return result;
}
export function settingsHeads(rows) {
  return Object.fromEntries(Object.entries(rows).map(([key,{at,id}])=>[key,{at,id}]));
}
export function settingsSnapshot(account) {
  const settings = spec.settings(account.personalization);
  const at = Date.parse(account.personalizationUpdatedAt) || 0;
  return Object.fromEntries(Object.entries(settings).map(([key,value]) =>
    [key,{value,...(account.personalizationChanges?.[key] ?? {at,id:''})}]));
}
export function changedSettings(rows, patch, now, id) {
  spec.validate(patch);
  return Object.fromEntries(Object.entries(patch).filter(([key,value])=>rows[key]?.value !== value)
    .map(([key,value])=>[key,{value,at:Math.max(now,(rows[key]?.at ?? 0)+1),id}]));
}
export function settingsView(cache) {
  const settings = Object.fromEntries(Object.entries(cache.rows).map(([key,row])=>[key,row.value]));
  const at = Math.max(0,...Object.values(cache.rows).map(row=>row.at));
  return {settings:spec.settings(settings),updatedAt:at ? new Date(at).toISOString() : null,
    synced:!Object.keys(cache.pending).length};
}
export function openSettingsReplica({codec,read,write,current,exchange,deviceId,random,now=Date.now}) {
  async function load() {
    const box = await read();
    const cache = box === undefined ? null : await codec.open('settings-cache',box);
    if (cache) mergeSettings({},cache.rows);
    current();
    return {box,cache};
  }
  async function save(box,cache) {
    const next = await codec.seal('settings-cache',cache);
    current();await write(box,next);
    return settingsView(cache);
  }
  return {
    async read() { const {cache} = await load();return cache && settingsView(cache); },
    async edit(patch) {
      const {box,cache} = await load();
      if (!cache) throw invalid();
      const changes = changedSettings(cache.rows,patch,now(),random());
      return save(box,{rows:mergeSettings(cache.rows,changes),pending:{...cache.pending,
        ...Object.fromEntries(Object.entries(changes).map(([key,row])=>[key,row.id]))}});
    },
    async sync() {
      const before = await load();
      const changes = Object.fromEntries(Object.keys(before.cache?.pending ?? {}).map(key=>[key,before.cache.rows[key]]));
      const requestId = random();
      const box = await codec.seal('settings-request',{deviceId,requestId,changes,known:settingsHeads(before.cache?.rows ?? {})});
      current();
      const reply = await exchange({box});
      const payload = await codec.open('settings-response',reply.box);
      current();
      if (payload.requestId !== requestId || Object.keys(payload.heads??{}).sort().join() !== Object.keys(spec.defaults).sort().join()) throw invalid();
      const remote=mergeSettings(before.cache?.rows ?? {},payload.rows);
      for(const key of Object.keys(spec.defaults)) {
        if(remote[key]?.at!==payload.heads[key]?.at || remote[key]?.id!==payload.heads[key]?.id) throw invalid();
      }
      // A late response may acknowledge an earlier edit while a newer edit is already durable.
      const latest = await load(), rows = mergeSettings(latest.cache?.rows ?? {},remote);
      const pending = Object.fromEntries(Object.entries(latest.cache?.pending ?? {}).filter(([key])=>newer(rows[key],remote[key])));
      if (latest.cache && JSON.stringify(latest.cache.rows) === JSON.stringify(rows) &&
          JSON.stringify(latest.cache.pending) === JSON.stringify(pending)) return settingsView(latest.cache);
      return save(latest.box,{rows,pending});
    },
  };
}
