import { healthScores, healthShiftDay } from './analysis.mjs';

const known = value => typeof value === 'number' && Number.isFinite(value);

/** Sleep duration and score are independent observations, over the exact query window. */
export function sleepQuerySummary(state, from, to, timeZone) {
  const items = [];
  for (let day = from; day <= to; day = healthShiftDay(day, 1)) {
    const sleep = healthScores(state, day, timeZone).sleep;
    const baselineNights = Array.from({ length: 28 }, (_, n) => state.days[healthShiftDay(day, -n - 1)]?.health)
      .filter(row => row?.status === 'available' && known(row.sleepMinutes)).length;
    items.push({ day, minutes: sleep.minutes, score: sleep.score, baselineNights,
      scoreMissing: [...sleep.missing, ...(baselineNights < 7 ? ['baselineNights'] : [])] });
  }
  const recorded = items.filter(item => known(item.minutes));
  return { unit: 'min', recordedDays: recorded.length, missingDays: items.length - recorded.length,
    averageMinutes: recorded.length ? Math.round(recorded.reduce((sum, item) => sum + item.minutes, 0) / recorded.length * 100) / 100 : null,
    scoreRecordedDays: items.filter(item => known(item.score)).length,
    scoreRequirement: '评分需要目标日之前28天内至少7夜有效时长；分期和入睡时间缺测会限制评分。有时长但没有评分，仍按已记录时长回答，不能说没有睡眠记录。',
    items };
}
