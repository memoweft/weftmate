import './apple3-health-presentation.test.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {checkAppleCopy, scanAppleCopy, swiftCopy} from '../Scripts/check_ui_copy.mjs';

test('Apple copy rejects mangled substitutions in labels and model errors', () => {
 const badCopy = [
  '选择这台电脑电脑上的项目文件夹。',
  '临时内容需要明确分享，当前请在临时对话远程连接续。',
  '模型单价 · 元 / 百万字元',
  '还没连上电脑状态',
  '电脑上的 WeftMate报告的实际状态；重启可能中断当前任务。',
  '通过iPhone接收，仅保存在这两台设备。',
 ];
 for (const text of badCopy) {
  for (const source of [`Text("${text}")`, `error = "${text}"`]) {
   const copies = swiftCopy(source);
   assert.equal(copies.length, 1);
   assert.throws(() => checkAppleCopy(copies[0]), /broken Apple copy/);
  }
 }
});

test('Apple copy preserves ordinary words containing old internal terms', () => {
 for (const text of [
  '选择这台电脑上的项目文件夹。',
  '请在电脑上创建项目。',
  '临时内容需要明确分享，当前请在临时对话中继续。',
  '模型单价 · 元 / 百万字',
  '还没连上电脑',
  '电脑上的 WeftMate 报告的状态；重启可能中断当前任务。',
  '通过 iPhone 接收，仅保存在这两台设备。',
 ]) assert.doesNotThrow(() => checkAppleCopy(text));
});

test('all authored Apple interface strings pass the copy regression scan', async () => {
 const result = await scanAppleCopy();
 assert.ok(result.authoredStrings > 100);
});
