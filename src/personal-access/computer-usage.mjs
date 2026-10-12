/** Time-only local computer observations. No application/window/content access. */
import { localNotificationTime } from './notification-policy.mjs';
const MINUTE = 60000;
const rounded = value => Math.round(value * 10000) / 10000;
const dayIndexes = new WeakMap();
const formatters = new Map();
function indexedDays(buckets, timeZone) {
  let zones = dayIndexes.get(buckets); if (!zones) { zones = new Map(); dayIndexes.set(buckets, zones); }
  if (zones.has(timeZone)) return zones.get(timeZone);
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }); formatters.set(timeZone, formatter); }
  const days = new Map();
  for (const row of buckets) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(row.start)).map(p => [p.type, p.value]));
    const day = `${p.year}-${p.month}-${p.day}`, hour = Number(p.hour), quarter = hour * 4 + Math.floor(Number(p.minute) / 15);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ row, hour, quarter });
  }
  zones.set(timeZone, days); return days;
}
const noBuckets = [];

/** A delayed timer cannot prove what happened during sleep or an absent process. */
export function computerUsageInterval({ from, to, idleSeconds, locked = false, timeZone }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 90000 || !Number.isFinite(idleSeconds) || idleSeconds < 0) return [];
  const activeEnd = locked ? from : Math.max(from, Math.min(to, to - idleSeconds * 1000 + 5 * MINUTE));
  const rows = [];
  for (let at = from; at < to;) {
    const minuteEnd = Math.min(to, (Math.floor(at / MINUTE) + 1) * MINUTE);
    const local = localNotificationTime(at, timeZone), minute = Number(local.time.slice(3, 5));
    const start = new Date(Math.floor(at / MINUTE) * MINUTE - (minute % 15) * MINUTE).toISOString();
    const end = Math.min(minuteEnd, activeEnd), active = Math.max(0, end - at) / MINUTE;
    rows.push({ start, activeMinutes: active, observedMinutes: (minuteEnd - at) / MINUTE,
      firstUsedAt: active ? new Date(at).toISOString() : null, lastUsedAt: active ? new Date(end).toISOString() : null });
    at = minuteEnd;
  }
  return mergeComputerBuckets([], rows);
}

export function mergeComputerBuckets(previous, additions) {
  const rows = new Map(previous.map(row => [row.start, { ...row }]));
  for (const value of additions) {
    const row = rows.get(value.start) ?? { start: value.start, activeMinutes: 0, observedMinutes: 0, firstUsedAt: null, lastUsedAt: null };
    row.activeMinutes = rounded(row.activeMinutes + value.activeMinutes);
    row.observedMinutes = rounded(row.observedMinutes + value.observedMinutes);
    if (value.firstUsedAt && (!row.firstUsedAt || value.firstUsedAt < row.firstUsedAt)) row.firstUsedAt = value.firstUsedAt;
    if (value.lastUsedAt && (!row.lastUsedAt || value.lastUsedAt > row.lastUsedAt)) row.lastUsedAt = value.lastUsedAt;
    rows.set(row.start, row);
  }
  return [...rows.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export function computerDay(account, day, timeZone) {
  const entries = indexedDays(account.dailyDigest?.computerUsage?.buckets ?? noBuckets, timeZone).get(day) ?? [];
  if (!entries.length) return null;
  const buckets = entries.map(entry => entry.row);
  const hourly = Array(24).fill(null), quarterHours = Array(96).fill(null);
  let activeMinutes = 0, observedMinutes = 0, lateNightMinutes = 0;
  for (const { row, hour, quarter } of entries) {
    activeMinutes += row.activeMinutes; observedMinutes += row.observedMinutes;
    if (hour >= 1 && hour < 6) lateNightMinutes += row.activeMinutes;
    hourly[hour] = rounded((hourly[hour] ?? 0) + row.activeMinutes);
    quarterHours[quarter] = rounded((quarterHours[quarter] ?? 0) + row.activeMinutes);
  }
  return { deviceId: 'this-computer', label: '这台电脑', platform: 'windows', source: 'computer', activeMinutes: rounded(activeMinutes), observedMinutes: rounded(observedMinutes),
    lateNightMinutes: rounded(lateNightMinutes), hourly, quarterHours, buckets,
    firstUsedAt: buckets.map(row => row.firstUsedAt).filter(Boolean).sort()[0] ?? null,
    lastUsedAt: buckets.map(row => row.lastUsedAt).filter(Boolean).sort().at(-1) ?? null };
}

export function resolvedComputerUsage(account, day, timeZone) {
  const computer = computerDay(account, day, timeZone);
  if (computer) return { activeMinutes: computer.activeMinutes, lateNightMinutes: computer.lateNightMinutes, source: 'computer' };
  const chat = account.dailyDigest?.days?.[day]?.usage;
  return { activeMinutes: chat?.estimatedActiveMinutes ?? null, lateNightMinutes: chat?.lateNightMinutes ?? null, source: 'chat' };
}

export function computerNight(account, day, timeZone) {
  const previous = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const days = indexedDays(account.dailyDigest?.computerUsage?.buckets ?? noBuckets, timeZone);
  const rows = [...(days.get(previous) ?? []).filter(entry => entry.hour >= 18), ...(days.get(day) ?? []).filter(entry => entry.hour < 12)].map(entry => entry.row);
  return rows.length ? { lastUsedAt: rows.map(row => row.lastUsedAt).filter(Boolean).sort().at(-1) ?? null, source: 'computer' } : null;
}
