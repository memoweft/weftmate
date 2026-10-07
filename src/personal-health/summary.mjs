import { createHash } from 'node:crypto';

export const HEALTH_BODY_MAX = 12 * 1024;
export const healthFailure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required = []) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) throw healthFailure('INVALID_HEALTH_SUMMARY');
};
export function healthDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw healthFailure('INVALID_DATE');
  return value;
}
const instant = (value) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && (() => {
    try { healthDate(value.slice(0, 10)); return true; } catch { return false; }
  })();
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const UNITS = { sleep: 'min', steps: 'count', activeEnergy: 'kcal', heartRate: 'bpm',
  restingHeartRate: 'bpm', hrv: 'ms', respiratoryRate: 'breaths/min', workouts: 'min' };
const STATES = ['disabled', 'notRequested', 'dataAvailable', 'noDataOrReadDenied', 'unavailable', 'failed'];

/** Only daily aggregates are accepted; no arbitrary text or raw sample payloads. */
export function healthSummary(value) {
  keys(value, ['schemaVersion', 'date', 'timeZone', 'sourceDeviceId', 'sourceDevices', 'summarizedAt',
    'cloudModelAllowed', 'selfAssessmentFrequency', 'readStates', 'metrics', 'sleep', 'workoutCount', 'workoutMinutes'],
  ['schemaVersion', 'date', 'timeZone', 'sourceDeviceId', 'sourceDevices', 'summarizedAt',
    'cloudModelAllowed', 'readStates', 'metrics']);
  healthDate(value.date);
  if (value.schemaVersion !== 1 || typeof value.timeZone !== 'string' || value.timeZone.length > 128 ||
      typeof value.sourceDeviceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.sourceDeviceId) ||
      !Array.isArray(value.sourceDevices) || value.sourceDevices.some((item) =>
        typeof item !== 'string' || !item.trim() || item.length > 256) ||
      !instant(value.summarizedAt) || typeof value.cloudModelAllowed !== 'boolean' ||
      !['off', 'low', 'moderate'].includes(value.selfAssessmentFrequency === undefined ? 'low' : value.selfAssessmentFrequency)) {
    throw healthFailure('INVALID_HEALTH_SUMMARY');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); }
  catch { throw healthFailure('INVALID_HEALTH_SUMMARY'); }
  keys(value.readStates, Object.keys(UNITS));
  if (Object.values(value.readStates).some((item) => !STATES.includes(item))) throw healthFailure('INVALID_HEALTH_SUMMARY');
  keys(value.metrics, Object.keys(UNITS));
  for (const [kind, metric] of Object.entries(value.metrics)) {
    keys(metric, ['value', 'unit', 'baselineMean', 'baselineDays', 'deviationPercent'], ['value', 'unit', 'baselineDays']);
    if (!number(metric.value) || metric.unit !== UNITS[kind] || !Number.isInteger(metric.baselineDays) ||
        metric.baselineDays < 0 || metric.baselineDays > 14 ||
        (metric.baselineMean !== undefined && (!number(metric.baselineMean) || metric.baselineDays === 0)) ||
        (metric.deviationPercent !== undefined && (typeof metric.deviationPercent !== 'number' ||
          !Number.isFinite(metric.deviationPercent) || !(metric.baselineMean > 0))) ||
        !['dataAvailable', 'failed'].includes(value.readStates[kind])) throw healthFailure('INVALID_HEALTH_SUMMARY');
  }
  if (value.sleep !== undefined) {
    keys(value.sleep, ['totalMinutes', 'fellAsleepAt', 'wokeAt'], ['totalMinutes']);
    if (!number(value.sleep.totalMinutes) || !value.metrics.sleep || value.sleep.totalMinutes !== value.metrics.sleep.value ||
        ['fellAsleepAt', 'wokeAt'].some((key) => value.sleep[key] !== undefined && !instant(value.sleep[key])) ||
        (value.sleep.fellAsleepAt && value.sleep.wokeAt &&
          Date.parse(value.sleep.fellAsleepAt) > Date.parse(value.sleep.wokeAt))) throw healthFailure('INVALID_HEALTH_SUMMARY');
  }
  if (value.workoutCount !== undefined && (!Number.isSafeInteger(value.workoutCount) || value.workoutCount < 0) ||
      value.workoutMinutes !== undefined && !number(value.workoutMinutes) ||
      (value.workoutCount !== undefined || value.workoutMinutes !== undefined) &&
        !['dataAvailable', 'failed'].includes(value.readStates.workouts)) throw healthFailure('INVALID_HEALTH_SUMMARY');
  return { ...structuredClone(value), summarizedAt: new Date(value.summarizedAt).toISOString(),
    sourceDevices: [...new Set(value.sourceDevices)], selfAssessmentFrequency: value.selfAssessmentFrequency ?? 'low' };
}

const sorted = (value) => !object(value) ? (Array.isArray(value) ? value.map(sorted) : value)
  : Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
export const summaryHash = (value) => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
const decimal = (value) => String(Number(value.toFixed(2)));
const minutes = (value) => {
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)} 小时 ${rounded % 60} 分`;
};
const LABELS = { sleep: '睡眠', steps: '步数', activeEnergy: '活动能量', heartRate: '平均心率',
  restingHeartRate: '静息心率', hrv: 'HRV', respiratoryRate: '呼吸频率', workouts: '锻炼时长' };
const CHINESE_UNITS = { min: '分钟', count: '步', kcal: '千卡', bpm: '次/分', ms: '毫秒', 'breaths/min': '次/分' };

export function observedHealthEvidence(ownerId, summary) {
  const lines = Object.entries(summary.metrics).map(([kind, metric]) => {
    let text = `${summary.date} ${LABELS[kind]} ${kind === 'sleep' ? minutes(metric.value)
      : `${decimal(metric.value)} ${CHINESE_UNITS[metric.unit]}`}`;
    if (metric.baselineMean !== undefined && metric.value !== metric.baselineMean) {
      const difference = Math.abs(metric.value - metric.baselineMean);
      text += `，${metric.value < metric.baselineMean ? '低于' : '高于'}此前 14 天基线均值 ${kind === 'sleep'
        ? minutes(difference) : `${decimal(difference)} ${CHINESE_UNITS[metric.unit]}`}（${metric.baselineDays} 天有数据）`;
    }
    if (summary.readStates[kind] === 'failed') text += '（本次查询失败，保留此前读数）';
    return `${text}。`;
  });
  if (summary.workoutCount !== undefined) lines.push(`${summary.date} 锻炼 ${summary.workoutCount} 次${
    summary.workoutMinutes !== undefined ? `，活动时长 ${decimal(summary.workoutMinutes)} 分钟` : ''}。`);
  const sourceId = `weftmate-health-v1:${summaryHash([ownerId, summary.sourceDeviceId, summary.date])}`;
  return { schema_version: 1, subject_id: ownerId, source_kind: 'observed', source_id: sourceId,
    evidence_id: sourceId, payload_hash: summaryHash(summary), content: lines.join('\n'),
    source: { device_id: summary.sourceDeviceId, devices: summary.sourceDevices, date: summary.date,
      time_zone: summary.timeZone, summarized_at: summary.summarizedAt },
    permissions: { allow_local_read: true, allow_cloud_read: summary.cloudModelAllowed, allow_inference: true } };
}
