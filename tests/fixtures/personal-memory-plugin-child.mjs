/** Forked DSH hook-shape harness for the real account-memory plugin module. */
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = mkdtempSync(join(tmpdir(), 'weftmate-memory-plugin-'));
const pluginPath = join(root, 'weftmate-personal-memory.mjs');
copyFileSync(fileURLToPath(new URL('../../src/plugins/weftmate-personal-memory.mjs', import.meta.url)), pluginPath);
if (process.argv.includes('--privacy-only')) {
  // Portable contract test for the final derivation path. The real DSH factory
  // remains exercised by the existing vendor test and MEM-2 Electron evidence.
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-llm/message') return { shortCircuit:true,
      url:'data:text/javascript,'+encodeURIComponent('export const createUserMessage = input => ({id:crypto.randomUUID(),role:"user",...input});') };
    return next(specifier, context);
  } });
} else symlinkSync(fileURLToPath(new URL('../../vendor/dsh-runtime/node_modules', import.meta.url)),
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
  const value = { id, header: { agentPreset: preset }, deriveMessages() { return this.events.filter(event => event.type === 'user/message').map(event => event.data); }, append(type, data) { const event = Object.freeze({ seq: this.events.length + 1, type, data }); this.events.push(event); return event; }, events: [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
  ] };
  handlers.get('session/created')(value);
  return value;
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
    currentQuestionLast: result.messages.at(-1)?.source?.kind === 'user',
    last: injected.at(-1) ? { id: injected.at(-1).id, role: injected.at(-1).role,
      source: injected.at(-1).source, frozen: Object.isFrozen(injected.at(-1)),
      sourceFrozen: Object.isFrozen(injected.at(-1).source) } : null };
}
process.on('message', async (message) => {
  if (message?.type === 'run-private') {
    try {
      const value = session('session-private');
      const old = { ...userClaim('old'), content: [{type:'text',text:'PRIVATE_HISTORY_SENTINEL'}] };
      const current = userClaim('ordinary');
      value.events.push({seq:2,type:'user/message',data:old}, {seq:3,type:'turn/start',data:{turn:3}},
        {seq:4,type:'user/message',data:current});
      const result = await preStep('session-private', {session:value}, value.deriveMessages(), [current]);
      for (const item of result.messages.filter(row=>row.source?.plugin==='weftmate-personal-memory')) value.append('user/message',item);
      process.send({type:'result', preStep:result.messages, derived:value.deriveMessages()});
    } catch { process.send({type:'failed'}); }
    return;
  }
  if (message?.type !== 'run') return;
  try {
    const agentA = { session: session('session-a') };
    const a = await preStep('session-a', agentA);
    for (const message of a.messages) agentA.session.append('user/message', message);
    const latestContextCount = agentA.session.deriveMessages().filter(message => message.source?.plugin === 'weftmate-personal-memory').length;
    const adopted = agentA.session.append('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '采用回复' }] } }).data.memoryUsed;
    agentA.session.events.push({ seq: 2, type: 'user/message', data: userClaim('session-a') });
    const laterClaim = [{ role: 'assistant', content: [{ type: 'text', text: 'tool continuation' }],
      source: { kind: 'plugin', plugin: 'other' } }];
    const aWithheld = await preStep('session-a', agentA, a.messages, laterClaim);
    const withheldContextCount = agentA.session.deriveMessages().filter(message => message.source?.plugin === 'weftmate-personal-memory').length;
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
    process.send({ type: 'result', adopted, latestContextCount, withheldContextCount, a, aWithheld, aUpdated, empty, b, ambiguous, cloud, noClaim });
  } catch { process.send({ type: 'failed' }); }
});
