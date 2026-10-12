import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkAppleCopy, swiftCopy } from '../Scripts/check_ui_copy.mjs';
const source = file => readFile(new URL(file,import.meta.url),'utf8');
test('HEALTH-1 requests exactly five read types and no write types',async()=>{
    const reader=await source('../iOS/DailyHealthReader.swift');
    const types=reader.slice(reader.indexOf('static var types:'),reader.indexOf('private var observers'));
    const names=[...types.matchAll(/forIdentifier:\s*\.(\w+)/g)].map(m=>m[1]);
    assert.deepEqual(names,['stepCount','sleepAnalysis','restingHeartRate','appleExerciseTime']);
    assert.equal((types.match(/workoutType\(\)/g)??[]).length,1);
    assert.match(reader,/requestAuthorization\(toShare: \[\], read:/);
    assert.doesNotMatch(reader,/store\.save\(/);
});
test('HEALTH-1 normal phone launch uses new daily flow and no old broad reader',async()=>{
    const phone=await source('../iOS/WeftMatePhoneApp.swift'), root=await source('../UI/WeftMateRootView.swift');
    assert.match(phone,/StateObject private var health = DailyHealthModel/);
    assert.doesNotMatch(root,/health\.activate|HealthSettingsModel/);
    assert.doesNotMatch(await source('../iOS/DailyHealthModel.swift'),/cloudLogin|URLSession|uploadHealthSummary/);
});
test('HEALTH-1 writers are only dependencies of the UI test target',async()=>{
    const project=await source('../Scripts/generate_project.py');
    const app=project.split('target("WeftMatePhone",')[1].split('\n')[0];
    assert.doesNotMatch(app,/HEALTH1SeedApp|HealthSeed/);
    assert.match(project,/if name == "WeftMatePhoneUITests":\s*deps\.extend/);
    assert.match(project,/target\("WeftMateHealthSeedPhone", "iphoneos", \["Tests\/HEALTH1SeedApp.swift"\]\)/);
    const target=project.slice(project.indexOf("def target("));
    const phone=target.slice(target.lastIndexOf('if name == "WeftMatePhone":'),target.indexOf('cfg = configs'));
    assert.doesNotMatch(phone,/NSHealthUpdateUsageDescription/);
});
test('HEALTH-1 authored visible copy passes the repository vocabulary rules',async()=>{
    for(const file of ['../iOS/DailyHealthViews.swift','../iOS/DailyHealthModel.swift']) {
        for(const copy of swiftCopy(await source(file)))checkAppleCopy(copy,file);
    }
});

test('HEALTH-1 fixture observation preserves request bytes across delayed authentication',async()=>{
    const { Readable } = await import('node:stream');
    const { setTimeout } = await import('node:timers/promises');
    const { observeBody } = await import('./health1_observe_body.mjs');
    const body=Buffer.from(JSON.stringify({version:1,status:'unavailable',steps:null,sleepMinutes:null,restingHeartRateBpm:null,exerciseMinutes:null,workouts:[]}));
    const request=Readable.from([body.subarray(0,15),body.subarray(15)]);
    let recorded;observeBody(request,bytes=>{recorded=bytes;});
    await setTimeout(10);
    const parts=[];for await (const chunk of request)parts.push(chunk);
    assert.deepEqual(Buffer.concat(parts),body);assert.deepEqual(recorded,body);
});
test('HEALTH-1 nonisolated callback factories retain their reviewed exact bodies',async()=>{
    const crypto=await import('node:crypto');
    const review=JSON.parse(await source('./Evidence/HEALTH-1/callback-review-bodies.json'));
    assert.equal(review.reviewed,true);
    for(const factory of review.factories) {
        const current=(await readFile(factory.file,'utf8')).replaceAll('\r\n','\n');
        assert.ok(current.includes(factory.body),factory.factory+' requires a new executor review after body changes');
        assert.equal(crypto.createHash('sha256').update(factory.body).digest('hex'),factory.sha256);
        assert.match(factory.body,/nonisolated/);assert.match(factory.body,/@Sendable/);
    }
});
