import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';
import { apply as applySharedPreset } from '../src/plugins/weftmate-personal-shared-chat-preset.mjs';

// Assert the real prompt assembly, not source text. Model adherence is verified
// separately on an installed candidate with the actual configured model.
function assertFormationContract(text: string) {
  assert.match(text, /Natural statements and explicit requests to remember/);
  assert.match(text, /automatically after a successful turn/);
  assert.match(text, /empty memory_query.*no existing match/);
  assert.match(text, /not permission to create a file/);
  assert.match(text, /explicitly requests a file deliverable/);
  assert.match(text, /temporary or unavailable.*do not promise/);
}

test('M1 ordinary prompt exposes new-fact formation without requiring file work or an old target', () => {
  const assembly = presentPersonalPrompt({ sections: [], tools: [] });
  assertFormationContract(assembly.sections.find(row => row.name === 'weftmate:shared-decisions').text);
});

test('M1 shared-account prompt exposes the same formation contract in a new conversation', async () => {
  let assemble: any;
  applySharedPreset({ tools: { restrict: () => () => {} },
    on(name: string, callback: any) { if (name === 'system-prompt/assemble') assemble = callback; }, effect() {} });
  const assembly = await assemble({}, {}, async () => ({ sections: [] }));
  assertFormationContract(assembly.sections.find(row => row.name === 'weftmate:shared-decisions').text);
});

test('M1 explicitly requested file deliverables keep their native write schema and selected tool', () => {
  const parameters = { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } };
  const instruction = { name: 'user-file-task', text: 'Write my travel preferences into a Markdown file.' };
  const result = presentPersonalPrompt({ sections: [instruction], tools: [{ name: 'write', description: 'Write file', parameters }] }, new Set(['write']));
  assert.deepEqual(result.tools.map(row => row.name), ['write']);
  assert.deepEqual(result.tools[0].parameters, parameters);
  assert.ok(result.sections.includes(instruction));
});

for (const [name, response] of [
  ['empty memory', { state: 'ready', contextText: '', memories: [] }],
  ['temporary conversation', { state: 'ready', contextText: '', memoryPolicy: { ingest: false, recall: true } }],
  ['unavailable memory', { state: 'withheld', reasonCode: 'MEMORY_UNAVAILABLE' }],
] as const) {
  test(`M1 new-conversation pre-step: ${name} does not invent saved facts or start file work`, { timeout: 12000 }, async () => {
    const child = fork(new URL('fixtures/personal-memory-plugin-child.mjs', import.meta.url), ['--protocol-only'], {
      env: { ...process.env, WEFTMATE_PERSONAL_MEMORY_ENABLED: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    const calls: string[] = [];
    try {
      const result: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('plugin fixture timeout')), 10000);
        child.once('exit', () => { clearTimeout(timer); reject(Error('plugin exited before result')); });
        child.once('error', reject);
        child.on('message', (message: any) => {
          if (message.type === 'ready') child.send({ type: 'run-peer-recall', preset: 'personal-shared-chat' });
          else if (message.type === 'result') { clearTimeout(timer); resolve(message); }
          else if (message.type === 'failed') { clearTimeout(timer); reject(Error(message.error)); }
          else if (message.protocol === 'weftmate.personal-memory.v1') {
            calls.push(message.action);
            child.send({ protocol: message.protocol, id: message.id, ok: true, result: response });
          }
        });
      });
      assert.deepEqual(calls, ['recall']);
      assert.equal(result.currentQuestionLast, true);
      if (name === 'temporary conversation') {
        assert.match(result.text, /不形成记忆，不承诺以后记住/);
      } else {
        assert.equal(result.count, 0);
        assert.equal(result.text, null);
      }
    } finally { child.kill(); }
  });
}
