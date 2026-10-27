import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function model() {
  const context:any = {WeftUiCore:{factories:{}}, URL, Intl};
  runInNewContext(readFileSync('src/ui-core/timeline-model.js','utf8'),context);
  return context.WeftUiCore;
}
test('a successful retry preserves the failed command as failed',()=>{
  const api=model();
  const failed=api.stepPresentation({toolName:'pwsh',state:'failed',summary:'运行测试'}, {terminal:true,reason:'completed'});
  assert.equal(failed.state,'failed');
  assert.match(failed.statusText,/失败/);
});
