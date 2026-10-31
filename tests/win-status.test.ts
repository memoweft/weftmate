// 保护：模型回合结束时，待审批和后台任务不能丢失状态，也不能被同回合残留步骤取代。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const scope: any = { WeftUiCore: {factories:{}}, Intl, URL, Date };
runInNewContext(readFileSync('src/ui-core/timeline-model.js','utf8'),scope);
const core = scope.WeftUiCore, ended = {terminal:true,reason:'completed'};
const step = (id: string, extra = {}) => ({stepId:id,toolName:'pwsh',summary:id,state:'running',...extra});

test('a terminal turn keeps its pending approval actionable without claiming active execution', () => {
  const pending = step('approval',{approvalStatus:'pending'});
  const view = core.progressText([pending],ended);
  assert.equal(view.running,false);
  assert.ok(view.text.includes('approval'));
  assert.notEqual(view.text,core.progressText([{...pending,approvalStatus:'allowed-once',state:'completed'}],ended).text);
});

test('a background job remains active after the turn; a stale ordinary call cannot replace it', () => {
  const job = step('background',{state:'completed',jobState:'running'});
  const expected = core.progressText([job],ended);
  assert.equal(expected.running,true);
  assert.deepEqual(core.progressText([job,step('stale')],ended),expected);
  assert.equal(core.progressText([{...job,jobState:'completed'}],ended).running,false);
});

test('an ended turn cannot turn a failed or interrupted reply back into active work', () => {
  const job = step('background',{jobState:'running'});
  assert.equal(core.progressText([job],{terminal:true,reason:'error'}).failed,true);
  assert.equal(core.progressText([job],{terminal:true,reason:'aborted'}).running,false);
});

test('an ordinary tool call without a result is not counted as completed when the turn ends', () => {
  const running = step('unfinished');
  const completed = {...running,state:'completed'};
  assert.notEqual(core.progressText([running],ended).text,core.progressText([completed],ended).text);
  assert.equal(core.progressText([running],ended).running,false);
  assert.notEqual(core.progressText([{...running,state:'pending'}],ended).text,core.progressText([completed],ended).text);
});
