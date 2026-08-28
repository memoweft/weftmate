import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hatchLocalPet, LOCAL_HATCH_PROVIDER } from '../src/pets/hatch.ts';

describe('本机 MCP 宠物孵化器', () => {
  it('只根据明确传入的摘要生成严格程序化设计，结果稳定且不含摘要/路径/权限', async () => {
    const input = { profileSummary: '喜欢直接沟通，重视隐私，也愿意亲自试用产品。', appearanceBrief: '希望沉稳一点，名字叫小验' };
    const first = await hatchLocalPet(input);
    const second = await hatchLocalPet(input);
    assert.deepEqual(second, first);
    assert.equal(first.name, '小验');
    assert.equal(first.appearance.kind, 'procedural');
    assert.deepEqual(Object.keys(first).sort(), ['appearance', 'description', 'name']);
    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes(input.profileSummary), false);
    assert.equal(/systemPrompt|memory|autonomy|mcp|[A-Z]:\\|file:\/\//i.test(serialized), false);
    assert.equal(LOCAL_HATCH_PROVIDER.leavesDevice, false);
  });

  it('过长输入在启动 MCP 前拒绝，取消信号会失败而不返回设计', async () => {
    await assert.rejects(() => hatchLocalPet({ profileSummary: 'x'.repeat(2_001) }), /画像摘要过长/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => hatchLocalPet({ profileSummary: '简短摘要' }, controller.signal), /取消/);
  });
});
