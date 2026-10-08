/** H3 wire validation only. Computation stays on the Apple device; private store/observed routing is unchanged. */
export function validateDeviceMetrics(value, { keys, instant, number, failure }) {
  const fail = () => { throw failure('INVALID_HEALTH_SUMMARY'); };
  const bounded = (n, max = 100) => number(n) && n <= max;
  const count = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
  const inputNames = ['sleep', 'hrv', 'restingHeartRate', 'respiratoryRate', 'heartRate', 'activeEnergy', 'workouts'];
  const inputs = (list, allowed) => Array.isArray(list) && list.length > 0 && new Set(list).size === list.length &&
    list.every(name => allowed.includes(name) && value.readStates[name] === 'dataAvailable');
  if (value.derived === undefined && value.hourly === undefined) return;
  // H3 explicitly excludes cloud-model usage, including older H1 opt-ins.
  if (value.cloudModelAllowed !== false) fail();
  if (value.derived !== undefined) {
    const d = value.derived;
    keys(d, ['algorithmVersion', 'recovery', 'load', 'sleep'], ['algorithmVersion']);
    if (d.algorithmVersion !== 'weftmate-h3-v1') fail();
    if (d.recovery !== undefined) {
      keys(d.recovery, ['value', 'inputs', 'baselineDays'], ['value', 'inputs', 'baselineDays']);
      if (!bounded(d.recovery.value) || !inputs(d.recovery.inputs, inputNames.slice(0, 4)) ||
          !count(d.recovery.baselineDays, 14) || d.recovery.baselineDays === 0) fail();
    }
    if (d.load !== undefined) {
      const l = d.load;
      keys(l, ['value', 'inputs', 'elevatedHeartRateMinutes', 'acute7Mean', 'chronic28Mean', 'ratio', 'acuteDays', 'chronicDays'],
        ['value', 'inputs', 'acuteDays', 'chronicDays']);
      if (!number(l.value) || !inputs(l.inputs, ['activeEnergy', 'workouts', 'heartRate']) ||
          !count(l.acuteDays, 7) || !count(l.chronicDays, 28) ||
          ['elevatedHeartRateMinutes', 'acute7Mean', 'chronic28Mean', 'ratio'].some(k => l[k] !== undefined && !number(l[k])) ||
          l.elevatedHeartRateMinutes !== undefined && (!l.inputs.includes('heartRate') || l.elevatedHeartRateMinutes > 1500) ||
          l.acute7Mean !== undefined && l.acuteDays !== 7 || l.chronic28Mean !== undefined && l.chronicDays !== 28 ||
          l.ratio !== undefined && (l.acute7Mean === undefined || !(l.chronic28Mean > 0))) fail();
    }
    if (d.sleep !== undefined) {
      const s = d.sleep;
      keys(s, ['stageMinutes', 'continuityPercent', 'durationScore', 'midpointDeviationMinutes', 'baselineDays'],
        ['stageMinutes', 'continuityPercent', 'baselineDays']);
      keys(s.stageMinutes, ['core', 'deep', 'rem', 'unspecified']);
      if (!value.sleep || value.readStates.sleep !== 'dataAvailable' || !bounded(s.continuityPercent) ||
          !count(s.baselineDays, 14) || Object.values(s.stageMinutes).some(n => !number(n)) ||
          Object.values(s.stageMinutes).reduce((a, b) => a + b, 0) > value.sleep.totalMinutes + 0.02 ||
          s.durationScore !== undefined && !bounded(s.durationScore) ||
          s.midpointDeviationMinutes !== undefined && !bounded(s.midpointDeviationMinutes, 720)) fail();
    }
  }
  if (value.hourly !== undefined) {
    if (!Array.isArray(value.hourly) || value.hourly.length > 25) fail();
    let previousEnd = -Infinity;
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateKey = timestamp => {
      const p = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
      return `${p.year}-${p.month}-${p.day}`;
    };
    for (const h of value.hourly) {
      keys(h, ['start', 'end', 'bodyBattery', 'stress'], ['start', 'end']);
      const start = Date.parse(h.start), end = Date.parse(h.end);
      if (!instant(h.start) || !instant(h.end) || !(end > start) || end - start > 3600000 ||
          start < previousEnd || dateKey(start) !== value.date || dateKey(end - 1) !== value.date ||
          end > Date.parse(value.summarizedAt) || h.bodyBattery === undefined && h.stress === undefined ||
          h.bodyBattery !== undefined && !bounded(h.bodyBattery)) fail();
      previousEnd = end;
      if (h.stress !== undefined) {
        const s = h.stress;
        keys(s, ['lower', 'upper', 'sampleCount', 'latestSampleAt', 'confidence'],
          ['lower', 'upper', 'sampleCount', 'latestSampleAt', 'confidence']);
        if (!bounded(s.lower) || !bounded(s.upper) || s.lower > s.upper ||
            !Number.isSafeInteger(s.sampleCount) || s.sampleCount < 1 || !['sparse', 'sampled'].includes(s.confidence) ||
            !instant(s.latestSampleAt) || Date.parse(s.latestSampleAt) < start || Date.parse(s.latestSampleAt) >= end ||
            !['hrv', 'heartRate'].every(k => value.readStates[k] === 'dataAvailable')) fail();
      }
    }
  }
}
