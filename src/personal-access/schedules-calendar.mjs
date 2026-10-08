const failure = (code) => Object.assign(new Error(code), { code });
export function scheduleContent(prompt) {
  try {
    const value = JSON.parse(prompt);
    if (value?.weftmate === 1 && ['reminder', 'task'].includes(value.kind) && typeof value.text === 'string' && value.text.trim()) {
      if (value.repeat !== undefined && (!['daily', 'weekly'].includes(value.repeat?.kind) ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value.repeat.time) ||
          value.repeat.kind === 'weekly' && (!Number.isInteger(value.repeat.weekday) || value.repeat.weekday < 0 || value.repeat.weekday > 6))) throw failure('INVALID_REQUEST');
      return { kind: value.kind, text: value.text.trim(), repeat: value.repeat ?? null };
    }
  } catch (error) { if (error.code) throw error; }
  return { kind: 'reminder', text: prompt, repeat: null };
}

/** Select the next local calendar date; the native at decoder resolves DST. */
export function nextCalendarInput(repeat, timeZone, now, afterDate = null) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (afterDate && afterDate > date.toISOString().slice(0, 10)) date.setTime(Date.parse(`${afterDate}T00:00:00Z`));
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  for (let day = 0; day <= 7; day++) {
    if ((!afterDate || date.toISOString().slice(0, 10) > afterDate) && (repeat.kind === 'daily' || date.getUTCDay() === repeat.weekday) && (day > 0 || repeat.time > localTime)) {
      return { date: date.toISOString().slice(0, 10), time: repeat.time, time_zone: timeZone };
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  throw failure('INVALID_REQUEST');
}

