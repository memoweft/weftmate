import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundBeforeUser } from '../src/plugins/weftmate-personal-memory.mjs';

const user = (id: string) => ({ id, role: 'user', source: { kind: 'user' } });
const context = (id: string) => ({ id, role: 'user', source: { kind: 'plugin' } });

test('memory and native DSH snapshots precede the current question without cloning it', () => {
  const question = user('swimming-question');
  const messages = backgroundBeforeUser([question, context('native'), context('approval')], [context('memory')]);
  assert.deepEqual(messages.map(message => message.id), ['native', 'approval', 'memory', 'swimming-question']);
  assert.equal(messages.at(-1), question);
});

test('a same-turn tool continuation keeps the current question as the last user input', () => {
  const tool = { id: 'tool-result', role: 'tool', source: { kind: 'tool' } };
  const messages = backgroundBeforeUser([context('old'), user('earlier'), user('current'),
    { id: 'assistant', role: 'assistant' }, tool, context('updated-memory')]);
  assert.deepEqual(messages.map(message => message.id), ['old', 'earlier', 'updated-memory', 'current', 'assistant', 'tool-result']);
  assert.equal(messages.filter(message => message.role === 'user').at(-1)?.id, 'current');
  assert.equal(messages.at(-1), tool);
});
