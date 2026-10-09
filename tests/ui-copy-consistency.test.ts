import assert from 'node:assert/strict';
import test from 'node:test';
import { authoredCopy, checkVisibleCopy, scanUiCopy } from '../scripts/check-ui-copy.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const fixture = () => { const context: any = { WeftUiCore: { factories: {} }, Intl, Date }; runInNewContext(readFileSync('src/ui-core/timeline-model.js','utf8'),context); return {api:context.WeftUiCore}; };

test('UX-1 authored interface copy and synthetic screenshot text contain no internal names', async () => {
  assert.ok(await scanUiCopy() >= 60);
});
test('UX-1 copy scanner rejects tool and field leaks, while code identifiers remain legal', () => {
  for (const text of ['来源：read', '运行 pwsh', 'ask_user_question', 'load_tools', 'mcp__calendar__list', 'Weave 组件', 'toolName: shell', 'undefined', 'null']) assert.throws(()=>checkVisibleCopy(text));
  const source = "const toolName='read'; const option={value:'shell'}; el('strong','','读取文件'); label.textContent='准备可用工具';";
  assert.deepEqual(authoredCopy(source,'component.js'),['读取文件','准备可用工具']);
  for(const copy of authoredCopy("el('span','','read'); label.textContent='Weave 组件';",'component.js')) assert.throws(()=>checkVisibleCopy(copy));
});
test('UX-1 shared dates honor the person’s timezone across day and month boundaries', () => {
  const {api}=fixture();
  assert.equal(api.dateText('2026-10-09T14:05:00Z',{timeZone:'Asia/Shanghai'}),'10 月 9 日 22:05');
  assert.equal(api.dateText('2026-09-30T16:05:00Z',{year:true,timeZone:'Asia/Shanghai'}),'2026 年 10 月 1 日 00:05');
  assert.equal(api.dateText('2026-10-01T00:05:00Z',{timeZone:'America/Los_Angeles'}),'9 月 30 日 17:05');
  assert.equal(api.dateText(null),'未记录'); assert.equal(api.monthText('2026-10'),'2026 年 10 月');assert.equal(api.dayText('2026-10-09'),'10 月 9 日');
});
test('UX-1 every operation uses the shared Chinese label and detail keys', () => {
  const {api}=fixture();
  for(const name of ['read','pwsh','shell','search','write','ask_user_question','load_tools','weftmod','unknown_connector']) { const label=api.toolLabel(name);assert.match(label,/[\u4e00-\u9fff]/);checkVisibleCopy(label); }
  assert.equal(api.interfaceText('执行工具 mcp__calendar__list'),'扩展服务');
  checkVisibleCopy(api.executionDetailText(JSON.stringify({arguments:{file_path:'使用说明.md',toolName:'read',query:'报告'},output:[{type:'text',text:'已读取。'}]})));
});
