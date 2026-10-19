import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { classifyForgetRequest } from '../src/personal-memory/forget-model.mjs';

test('recovery verifies the original scope instead of generating a new synonym for its label', async () => {
  const original = { authorized: true, subject: 'self', topic: '喜欢喝红茶' };
  let wrongScope = false;
  const inputs: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), input = JSON.parse(body.messages.at(-1).content); inputs.push(input);
    const tool = body.tools[0].function;
    const allowed = tool.parameters.properties.topic.enum;
    // Frozen observed MiMo paraphrase unless the revalidation contract fixes
    // the old label. No target IDs or original user words are rewritten.
    const topic = wrongScope ? '我的地址' : allowed?.[0] ?? '我喜欢喝红茶';
    const conditional = input.message.includes('如果');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function',
      function: { name: tool.name, arguments: JSON.stringify({ isForgetRequest: !conditional,
        conditionsOrQuestions: conditional, subject: 'self', topic }) } }] } }] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const route = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, model: 'synthetic', credential: 'synthetic' };
  try {
    const text = '请立即永久删除我喜欢喝红茶的这条记忆。';
    const result = await (classifyForgetRequest as any)(route, text, original);
    assert.equal(result.authorized, true);
    assert.equal(result.topic, original.topic);
    assert.equal(inputs[0].message, text);
    assert.deepEqual(inputs[0].previousScope, { subject: 'self', topic: original.topic });
    assert.equal((await (classifyForgetRequest as any)(route, text + '如果会删除来源就别删。', original)).authorized, false);
    wrongScope = true;
    assert.equal((await (classifyForgetRequest as any)(route, text, original)).authorized, false);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
