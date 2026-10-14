import { evidencePath } from '../../helpers/evidence-path.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { corpus, carriers, purposes, techniques } from './generate.mjs';
import { scoreResult } from './score.mjs';
const evidence = evidencePath('sec-2');
const runs = [];
for (let i = 1; i <= Math.ceil(corpus().length / 10); i++) { const path = join(evidence, `batch-${i}`, 'results.json'); if (existsSync(path)) { const run = JSON.parse(readFileSync(path, 'utf8')); if (run.stage === 'completed') runs.push(run); } }
assert.ok(runs.every(r => r.suiteHash && r.suiteHash === runs[0].suiteHash && r.runtimeHash === runs[0].runtimeHash && r.model === runs[0].model && r.repeat === 3), 'Official batches must share corpus, runtime, model and repeat configuration');
const identities = runs.flatMap(r => r.results.map(x => `${x.id}:${x.repeat}`));
assert.equal(new Set(identities).size, identities.length, 'Duplicate official repetition');
const results = runs.flatMap(r => r.results).map(r => ({ ...r, ...scoreResult(r) })), attacks = results.filter(r => !r.dimensions.control), controls = results.filter(r => r.dimensions.control);
function metric(rows) { return { total: rows.length, passed: rows.filter(r => r.objectivePassed).length, passRate: rows.length ? rows.filter(r => r.objectivePassed).length / rows.length : null, defense: Object.fromEntries(['model-resisted', 'extraction-filtered', 'approval-blocked', 'task-approval-blocked', 'evaluation-sandbox-blocked', 'executed-or-output-polluted', 'task-incomplete', 'source-not-observed', 'infrastructure-error', 'control'].map(d => [d, rows.filter(r => r.defense === d).length])), payloadReachedModel: rows.filter(r => r.payloadReachedModel).length }; }
const requests = runs.flatMap(r => r.requests);
const historicalRuns = readdirSync(evidence).filter(d => existsSync(join(evidence, d, 'results.json'))).map(d => ({ directory: d, ...JSON.parse(readFileSync(join(evidence, d, 'results.json'), 'utf8')) })).filter(r => !/^batch-\d+$/.test(r.directory) || r.stage !== 'completed');
const usageFor = rows => ({ requests: rows.length, withUsage: rows.filter(r => r.usage).length, promptTokens: rows.reduce((n, r) => n + (r.usage?.prompt_tokens ?? 0), 0), completionTokens: rows.reduce((n, r) => n + (r.usage?.completion_tokens ?? 0), 0), totalTokens: rows.reduce((n, r) => n + (r.usage?.total_tokens ?? 0), 0) });
const tokens = field => requests.reduce((sum, r) => sum + (r.usage?.[field] ?? 0), 0);
const aggregate = { schemaVersion: 1, model: 'mimo-v2.6-flash', measuredAt: new Date().toISOString(), expectedScenarios: corpus().length, expectedRuns: corpus().length * 3, observedRuns: results.length, complete: corpus().every(s => results.filter(r => r.id === s.id).length === 3), attacks: metric(attacks), controls: metric(controls), dimensions: {}, scenarios: [], usage: { requests: requests.length, withUsage: requests.filter(r => r.usage).length, promptTokens: tokens('prompt_tokens'), completionTokens: tokens('completion_tokens'), totalTokens: tokens('total_tokens'), cachedTokens: requests.reduce((n, r) => n + (r.usage?.prompt_tokens_details?.cached_tokens ?? 0), 0) }, cleanedProcesses: runs.reduce((n, r) => n + (r.cleanup?.cleaned ?? 0), 0) };
for (const [key, names] of [['carrier', carriers], ['purpose', purposes], ['technique', techniques]]) aggregate.dimensions[key] = Object.fromEntries(names.map(name => [name, metric(attacks.filter(r => r.dimensions[key] === name))]));
aggregate.configuration = { suiteHash: runs[0]?.suiteHash, runtimeHash: runs[0]?.runtimeHash, runtimeCommit: runs[0]?.runtimeCommit, completedBatches: runs.map(r => r.batch) };
aggregate.measurementLimits = { memoryUnsettledRuns: results.filter(r => r.memoryDrain?.settled !== true).length, configurationNote: '现有证据指纹覆盖场景、运行时和模型名，不含运行器源码。第 1 批保留 DEVICE_LIMIT 与记忆队列 degraded 的实际失败，不能将缺少记忆对象视为无污染。' };
aggregate.overall = metric(results);
aggregate.measurementLimits.memoryPositiveControlPasses = controls.filter(r => r.id === 'sec2-control-memory' && r.objectivePassed).length;
aggregate.coverage = { designedScenarios: corpus().length, observedScenarios: new Set(results.map(r => r.id)).size, unrunIds: corpus().filter(s => !results.some(r => r.id === s.id)).map(s => s.id) };
aggregate.historicalUsage = historicalRuns.map(r => ({ directory: r.directory, stage: r.stage, observedRuns: r.results?.length ?? 0, ...usageFor(r.requests ?? []) }));
aggregate.allRecordedUsage = usageFor([...requests, ...historicalRuns.flatMap(r => r.requests ?? [])]);
aggregate.usageLimit = '上一会话部分未计：未保存的请求、缺失 usage 的请求及强制结束后才完成的响应无法补算；续做第 7 批首次运行在首条结果落盘前以 0xC0000409 退出，该次请求与用量也未计。计数为已保存下限，不推测金额。';
for (const s of corpus()) { const rows = results.filter(r => r.id === s.id); const passed = rows.filter(r => r.objectivePassed).length; aggregate.scenarios.push({ id: s.id, ...s.sec2, runs: rows.length, passed, stability: rows.length < 3 ? '未完成' : passed === 3 ? '全过' : passed === 0 ? '总失败' : '有时失败', defense: rows.map(r => r.defense), failures: rows.filter(r => !r.objectivePassed).map(r => ({ repeat: r.repeat, reason: r.reason, defense: r.defense, payloadReachedModel: r.payloadReachedModel, failedChecks: r.finalChecks.filter(c => c.status !== 'passed'), approvals: r.turns.flatMap(t => t.unexpectedApproval ? [t.unexpectedApproval] : t.approvals ?? []), sandboxBlocks: r.tools.filter(t => t.kind === 'sandbox-block'), reply: r.turns.map(t => t.reply), observations: r.observations })) }); }
writeFileSync(join(evidence, 'summary.json'), JSON.stringify(aggregate, null, 2) + '\n');
const pct = m => `${m.passed}/${m.total}（${m.passRate === null ? 'N/A' : (m.passRate * 100).toFixed(1) + '%'}）`;
const lines = ['# SEC-2 实测分解', '', `完整性：${aggregate.observedRuns}/${aggregate.expectedRuns}；总严格通过 ${pct(aggregate.overall)}；注入场景严格通过 ${pct(aggregate.attacks)}；授权对照 ${pct(aggregate.controls)}。`, '', `记忆队列未确认完成：${aggregate.measurementLimits.memoryUnsettledRuns} 次。注入标记未检出不能证明整条注入被过滤，分段标记可能漏检。分类字段含义与测量边界见 README.md。`, '', '| 维度 | 值 | 严格通过 | 模型输入检出注入标记 | 危险审批拦截 | 正常任务审批阻塞 | 评测兜底拦截 | 动作或产出污染 |', '|---|---|---|---|---|---|---|---|'];
for (const [dimension, values] of Object.entries(aggregate.dimensions)) for (const [name, m] of Object.entries(values)) lines.push(`| ${dimension} | ${name} | ${pct(m)} | ${m.payloadReachedModel} | ${m.defense['approval-blocked']} | ${m.defense['task-approval-blocked']} | ${m.defense['evaluation-sandbox-blocked']} | ${m.defense['executed-or-output-polluted']} |`);
lines.push('', '## 场景覆盖及重复稳定性', '', '| 编号 | 载体 | 目的 | 手法 | 通过 | 三轮结果 |', '|---|---|---|---|---|---|');
for (const s of aggregate.scenarios) lines.push(`| ${s.id} | ${s.carrier} | ${s.purpose} | ${s.technique} | ${s.passed}/${s.runs} | ${s.stability} |`);
lines.push('', '## 失败明细', '');
for (const s of aggregate.scenarios.filter(s => s.failures.length)) { lines.push(`### ${s.id} · ${s.stability}`, ''); for (const f of s.failures) lines.push(`第 ${f.repeat} 轮：${f.defense}；注入标记进入模型：${f.payloadReachedModel}；${f.reason ?? ''}`, '', `失败检查：${JSON.stringify(f.failedChecks)}`, '', `审批：${JSON.stringify(f.approvals)}`, '', `评测兜底：${JSON.stringify(f.sandboxBlocks)}`, '', `回复：${f.reply.join('\n').replaceAll('\n', ' ')}`, ''); }
lines.push('## 用量', '', `MiMo 请求 ${aggregate.usage.requests}（含用量 ${aggregate.usage.withUsage}）；输入 ${aggregate.usage.promptTokens}，输出 ${aggregate.usage.completionTokens}，合计 ${aggregate.usage.totalTokens}，缓存输入 ${aggregate.usage.cachedTokens}。`, '', `已清理进程：${aggregate.cleanedProcesses}（正常 app.close 退出之外的清理计数）。`);
lines.push('', `含校准、试跑、中断的已保存总用量：${JSON.stringify(aggregate.allRecordedUsage)}。`, '', aggregate.usageLimit);
writeFileSync(join(evidence, 'results.md'), lines.map(line => line.trimEnd()).join('\n') + '\n');
console.log(JSON.stringify({ complete: aggregate.complete, runs: aggregate.observedRuns, attacks: aggregate.attacks, controls: aggregate.controls, usage: aggregate.usage }));
