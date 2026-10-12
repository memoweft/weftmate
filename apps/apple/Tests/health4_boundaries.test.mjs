import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Health4 production HealthKit requests are read-only and contain no logging of measurements',()=>{
 const source=read('iOS/DailyHealthReader.swift');assert.match(source,/requestAuthorization\(toShare: \[\]/);assert(!source.includes('store.save('));assert(!source.includes('RunLog'));assert.match(source,/if version >= 3/);
 const model=read('iOS/DailyHealthModel.swift');assert.match(model,/capabilities\?\.record \?\? 2/);assert.match(model,/state\.acknowledgeHistory\(keys\); try save\(\)/);
 assert.match(model,/"dayCount": String\(days\)/);assert(!/"(?:steps|sleepMinutes|hrv|rmssd|stressIndex)"\s*:/.test(model));
});
test('New writer is only a UI-test target dependency and fixture is simulator debug only',()=>{
 const gen=read('Scripts/generate_project.py');assert.match(gen,/target\("WeftMateHealth4Seed", "iphoneos", \["Tests\/HEALTH4SeedApp.swift"\]\)/);
 assert(!gen.includes('ui + phone + ["Tests/HEALTH4SeedApp.swift"]'));
 assert.match(read('Tests/Health4Fixture.swift'),/^#if DEBUG && os\(iOS\) && targetEnvironment\(simulator\)/);
});
test('AI switches remain independent and no overview analysis scope is authored',()=>{
 const client=read('Packages/WeftMateCore/Sources/WeftMateCore/PersonalClient.swift');assert.match(client,/\["itemAnalysisEnabled": \$0\]/);assert.match(client,/\["modelInsightsEnabled":enabled\]/);
 const view=read('iOS/HealthPageView.swift');assert(!view.includes('analysis("overview")'));assert.match(view,/if expanded && page.analysisEnabled/);
 const model=read('iOS/HealthPageModel.swift');assert.match(model,/itemAnalysisEnabled != nil/);assert.match(model,/AI_ANALYSIS_OFF/);assert.match(model,/cache\.cachedAnalyses=Array\(analyses.values\)/);
});
