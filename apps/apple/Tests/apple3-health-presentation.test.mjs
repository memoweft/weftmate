import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const view=readFileSync(new URL('../iOS/HealthPageView.swift',import.meta.url),'utf8');
const settings=readFileSync(new URL('../iOS/HealthAISettingsRow.swift',import.meta.url),'utf8');
test('iPhone health cards, details and trends leave the sole disclaimer by model settings',()=>{
 for(const file of ['HealthPageView.swift','HealthScoreRangeBar.swift','HealthMetricsView.swift','DailyHealthViews.swift','HealthPageNavigation.swift']) {
  const source=readFileSync(new URL('../iOS/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/医学结论|医疗建议|不是诊断|\.disclaimer|\["disclaimer"\]/,file);
 }
 assert.equal((settings.match(/不是医学结论/g)||[]).length,1);
 assert.match(settings,/Toggle\("今日解读用模型写"/);
 assert.match(settings,/Toggle\("各项 AI 分析"/);
 assert.doesNotMatch(view,/主要因为/);
 assert.match(view,/DisclosureGroup\("依据"/);
});
