import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { createMailer } from '../src/mail.mjs';
import { createLogger } from '../src/log.mjs';

test('file transport writes separate private messages and logs no recipient/code/body', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-mail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = loadConfig({ CLOUD_DATA_DIR: root }, root);
  let logs = '';
  const logger = createLogger({ stream: { write: (line) => { logs += line; } } });
  const mailer = createMailer(config, { logger });
  const message = { to: 'recipient@example.com', subject: 'Test verification', text: 'Fixture code: 123456\n开发邮件' };
  const sent = await Promise.all([mailer.send(message), mailer.send(message)]);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.equal((await readdir(config.mailDir)).length, 2);
  for (const { id } of sent) {
    const file = path.join(config.mailDir, `${id}.json`);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored.from, config.mailFrom);
    assert.equal(stored.to, message.to);
    assert.equal(stored.text, message.text);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  if (process.platform !== 'win32') assert.equal((await stat(config.mailDir)).mode & 0o777, 0o700);
  assert.doesNotMatch(logs, /recipient|123456|Test verification|开发邮件/);
  assert.equal(JSON.parse(logs.trim().split('\n')[0]).event, 'mail.written');
});

test('unsupported transports and malformed mail fail without claiming delivery', async () => {
  assert.throws(() => createMailer({ mailTransport: 'smtp' }), /not implemented/);
  const mailer = createMailer({ mailTransport: 'file' });
  await assert.rejects(mailer.send({ to: 'a\nb', subject: 'test', text: '' }), TypeError);
  await assert.rejects(mailer.send({ to: 'test@example.com', subject: 'a\nb', text: '' }), TypeError);
  await assert.rejects(mailer.send({ to: 'test@example.com', subject: 'test', text: null }), TypeError);
});
