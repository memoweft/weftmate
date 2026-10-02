/** Forked DSH hook-shape harness for the real account-memory plugin module. */
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-plugin-'));
const pluginPath = join(root, 'weftmate-personal-memory.mjs');
copyFileSync(fileURLToPath(new URL('../../src/plugins/weftmate-personal-memory.mjs', import.meta.url)), pluginPath);
symlinkSync(fileURLToPath(new URL('../../vendor/dsh-runtime/node_modules', import.meta.url)),
  join(root, 'node_modules'), 'junction');
process.on('exit', () => {
  if (realpathSync(root).startsWith(realpathSync(tmpdir()) + sep)) {
    rmSync(root, { recursive: true, force: true });
  }
});
const { apply } = await import(pathToFileURL(pluginPath).href);

const handlers = new Map();
apply({
  on(name, callback) { handlers.set(name, callback); },
  effect() {},
});
if (!handlers.has('agent/pre-step') || !handlers.has('session/event')) {
  throw new Error('personal-memory plugin hooks were not registered');
}
process.send({ type: 'ready' });

function session(id, preset = 'personal-shared-chat') {
  return { id, header: { agentPreset: preset }, events: [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
  ] };
}
const userClaim = (id) => ({ id: `user-${id}`, role: 'user',
  content: [{ type: 'text', text: '合成用户提问' }], source: { kind: 'user' } });
async function preStep(id, agent = { session: session(id) }, priorMessages = null, claimedMessages = null) {
  const claimed = claimedMessages ?? [userClaim(id)];
  const result = await handlers.get('agent/pre-step')({ agent, turn: 1, messages: claimed },
    async () => ({ kind: 'enter', messages: priorMessages ?? [
      ...claimed,
      { role: 'user', content: [{ type: 'text', text: 'STALE_A_CONTEXT' }],
        source: { kind: 'plugin', plugin: 'weftmate-personal-memory' } },
    ] }));
  const injected = result.messages.filter((message) => message.source?.plugin === 'weftmate-personal-memory');
  return { text: injected.at(-1)?.content?.[0]?.text ?? null,
    stale: JSON.stringify(result.messages).includes('STALE_A_CONTEXT'),
    count: injected.length, messages: result.messages,
    last: injected.at(-1) ? { id: injected.at(-1).id, role: injected.at(-1).role,
      source: injected.at(-1).source, frozen: Object.isFrozen(injected.at(-1)),
      sourceFrozen: Object.isFrozen(injected.at(-1).source) } : null };
}
process.on('message', async (message) => {
  if (message?.type !== 'run') return;
  try {
    const agentA = { session: session('session-a') };
    const a = await preStep('session-a', agentA);
    agentA.session.events.push({ seq: 2, type: 'user/message', data: userClaim('session-a') });
    const laterClaim = [{ role: 'assistant', content: [{ type: 'text', text: 'tool continuation' }],
      source: { kind: 'plugin', plugin: 'other' } }];
    const aWithheld = await preStep('session-a', agentA, a.messages, laterClaim);
    const aUpdated = await preStep('session-a', agentA, aWithheld.messages, laterClaim);
    const empty = await preStep('session-empty');
    const b = await preStep('session-b');
    const ambiguous = await preStep('session-ambiguous');
    const cloud = await preStep('session-cloud');
    const noClaim = await preStep('session-no-claim', { session: session('session-no-claim') }, null,
      [{ role: 'assistant', content: [{ type: 'text', text: 'not a user' }] },
        { role: 'user', content: [{ type: 'text', text: 'old plugin' }],
          source: { kind: 'plugin', plugin: 'weftmate-personal-memory' } }]);
    const current = session('session-a');
    current.events.push({ seq: 2, type: 'user/message', data: userClaim('session-a') });
    current.events.push({ seq: 3, type: 'assistant/message', data: { message: { id: 'assistant-a',
      content: [{ type: 'text', text: '合成回复' }] } } });
    const end = { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };
    current.events.push(end);
    handlers.get('session/event')(current, end);
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.send({ type: 'result', a, aWithheld, aUpdated, empty, b, ambiguous, cloud, noClaim });
  } catch { process.send({ type: 'failed' }); }
});
