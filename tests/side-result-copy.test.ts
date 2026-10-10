import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('side result copy shows one truthful state and readable tool descriptions for stored and new cards',()=>{
  const context:any={WeftUiCore:{factories:{}}};vm.runInNewContext(readFileSync('src/ui-core/timeline-model.js','utf8'),context);
  const text=context.WeftUiCore.sideResultText;
  assert.equal(text({state:'completed',summary:'已完成：已完成文件整理'}),'已完成 · 文件整理');
  assert.equal(text({state:'stopped',summary:'已完成：已停止读取 `read_file`'}),'已停止 · 读取 读取文件');
  assert.equal(text({state:'failed',summary:'已拒绝：执行 `pwsh`'}),'执行失败 · 执行 运行命令');
  assert.equal(text({state:'stopped',summary:''}),'已停止');
  assert.equal(text({state:'completed',summary:'已完成：已停止 `read_file`'}),'已停止 · 读取文件');
  assert.equal(text({state:'completed',summary:'已完成：已拒绝运行命令'}),'已拒绝 · 运行命令');
  assert.equal(text({state:'completed',summary:'读取 `read.md` 与 notes/read，使用 `read_file`'}),'已完成 · 读取 read.md 与 notes/read，使用 读取文件');
});
