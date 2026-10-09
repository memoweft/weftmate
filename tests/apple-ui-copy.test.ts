import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {scanAppleCopy,swiftCopy} from '../apps/apple/Scripts/check_ui_copy.mjs';
import {checkVisibleCopy} from '../scripts/check-ui-copy.mjs';
test('Apple operation names are generated from the shared ui-core tables',()=>{
 execFileSync(process.execPath,['apps/apple/Scripts/generate_operation_names.mjs','--check']);
});
test('Apple authored Swift/resources and captured synthetic native text contain no internal metadata names',async()=>{
 const result=await scanAppleCopy();assert.ok(result.authoredStrings>100);assert.ok(result.screenshotFrames>=10);
});
test('Swift copy scanner rejects visible names and permits wire keys and identifiers',()=>{
 const values=swiftCopy('Text("执行工具 read_file").accessibilityIdentifier("read_file"); let key = "toolName"; TextField("file_path", text: $draft); var errorDescription: String? { "错误：mcp__demo__tool" }');
 assert.equal(values.length,3);for(const value of values)assert.throws(()=>checkVisibleCopy(value));
});

test('A13 keeps every required native scene in both Mac/iPhone themes plus Watch approval',()=>{
 const data=JSON.parse(readFileSync(new URL('../apps/apple/Tests/Evidence/A13/screenshot-text.json',import.meta.url),'utf8'));
 const scenes=['approval-priority','single-choice','description','other-input-return','multiple-choice','free-answer','answered','retry-reconciled','chinese-sources','chinese-detail','usage-month','usage-month-picker','usage-month-selected'];
 for(const surface of ['mac','iphone'])for(const theme of ['light','dark'])for(const scene of scenes)assert.ok(data.frames.some(frame=>frame.surface===surface&&frame.theme===theme&&frame.scene===scene),`${surface}/${theme}/${scene}`);
 assert.ok(data.frames.some(frame=>frame.surface==='watch'&&frame.scene==='approval'));
});
