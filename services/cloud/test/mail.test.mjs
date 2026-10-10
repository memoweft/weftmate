import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { createMailer, MAX_MAIL_HTML_BYTES } from '../src/mail.mjs';
import { challengeMail, passwordChangedMail, emailChangedMail, MAIL_MARK_URL } from '../src/mail-templates.mjs';
import { createLogger } from '../src/log.mjs';

test('file transport writes separate private messages and logs no recipient/code/body', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-mail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = loadConfig({ CLOUD_DATA_DIR: root }, root);
  let logs = '';
  const logger = createLogger({
    stream: {
      write: (line) => {
        logs += line;
      },
    },
  });
  const mailer = createMailer(config, { logger });
  const message = {
    to: 'recipient@example.com',
    subject: 'Test verification',
    text: 'Fixture code: 123456\n开发邮件',
    html: challengeMail('register', '123456').html,
  };
  const sent = await Promise.all([mailer.send(message), mailer.send(message)]);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.equal((await readdir(config.mailDir)).length, 2);
  for (const { id } of sent) {
    const file = path.join(config.mailDir, `${id}.json`);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored.from, config.mailFrom);
    assert.equal(stored.to, message.to);
    assert.equal(stored.text, message.text);
    assert.equal(stored.html, message.html);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  if (process.platform !== 'win32') assert.equal((await stat(config.mailDir)).mode & 0o777, 0o700);
  assert.doesNotMatch(logs, /recipient|123456|Test verification|开发邮件/);
  assert.equal(JSON.parse(logs.trim().split('\n')[0]).event, 'mail.written');
  await mailer.deleteAccount('synthetic-account', [message.to]);
  assert.deepEqual(await readdir(config.mailDir), []);
});

test('Resend request uses configured secrets, template text and idempotency; errors are not delivery', async () => {
  const calls = [];
  const config = {
    mailTransport: 'resend',
    mailFrom: 'sender@example.com',
    resendApiKey: 'fixture-not-a-real-key',
  };
  const mailer = createMailer(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: 'provider-fixture' }), { status: 200 });
    },
  });
  assert.deepEqual(
    await mailer.send({ to: 'recipient@example.com', subject: '验证码', text: '测试验证码' }),
    { id: 'provider-fixture' },
  );
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.authorization, 'Bearer fixture-not-a-real-key');
  assert.match(calls[0].options.headers['idempotency-key'], /^[a-f0-9-]{36}$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: '验证码',
    text: '测试验证码',
  });
  assert.throws(() => createMailer({ mailTransport: 'resend' }), /not configured/);
  const failing = createMailer(config, {
    fetchImpl: async () =>
      new Response('provider failure containing sensitive fields', { status: 500 }),
  });
  await assert.rejects(
    failing.send({ to: 'recipient@example.com', subject: 'test', text: 'secret' }),
    /MAIL_DELIVERY_FAILED/,
  );
});

test('unsupported transports and malformed mail fail without claiming delivery', async () => {
  assert.throws(() => createMailer({ mailTransport: 'smtp' }), /not implemented/);
  const mailer = createMailer({ mailTransport: 'file' });
  await assert.rejects(mailer.send({ to: 'a\nb', subject: 'test', text: '' }), TypeError);
  await assert.rejects(
    mailer.send({ to: 'test@example.com', subject: 'a\nb', text: '' }),
    TypeError,
  );
  await assert.rejects(
    mailer.send({ to: 'test@example.com', subject: 'test', text: null }),
    TypeError,
  );
});

test('six templates share a safe card, code-free subject/preview and continuous fixture code', () => {
  for (const purpose of ['register', 'reset', 'device', 'email']) {
    const message = challengeMail(purpose, '012345', 'synthetic-device');
    assert.deepEqual(Object.keys(message), ['subject', 'text', 'html']);
    assert.equal(/验证码：(\d{6})/.exec(message.text)[1], '012345');
    assert.match(message.text, /^.+\n验证码：012345\n10 分钟内有效，只能使用一次。\n/);
    assert.match(message.html, /class="mail-ink mail-code"[^>]*>012345<\/p>/);
    assert.match(message.html, /font-variant-numeric:tabular-nums;[^"]*letter-spacing:4px;white-space:nowrap/);
    assert.match(message.html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(message.html, /\[if mso\]/);
    assert.doesNotMatch(message.subject, /012345/);
    assert.doesNotMatch(message.html.match(/<div class="mail-preview"[^>]*>(.*?)<\/div>/s)[1], /012345/);
    assert.equal(message.html.match(/<img /g).length, 1);
    assert.ok(message.html.includes(`src="${MAIL_MARK_URL}"`));
    assert.doesNotMatch(message.html, /<script|<form|<svg|data:|<link|background-image|https:[^" ]*\?/i);
    assert.ok(Buffer.byteLength(message.html) < MAX_MAIL_HTML_BYTES);
  }
  for (const message of [passwordChangedMail(), emailChangedMail()]) {
    assert.match(message.html, /class="mail-card"/);
    assert.doesNotMatch(message.html, /mail-code|联系支持|支持团队/);
    assert.doesNotMatch(message.text, /验证码|联系支持|支持团队/);
  }
});

test('HTML escapes script, quotes and ampersands; plain text keeps the original device identifier', () => {
  const device = '<script>"x" & \'y\'</script>';
  const message = challengeMail('device', '123456', device);
  assert.ok(message.text.includes(`设备标识：${device}`));
  assert.ok(message.html.includes('设备标识：&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'));
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /内容权限须另行配对/);
  for (const code of ['12345', '1234567', '12 345', '<1234>', '１２３４５６', '123456\n', 123456, null]) {
    assert.throws(() => challengeMail('register', code), /six digits/);
  }
  assert.throws(() => challengeMail('unknown', '123456'), /Unknown/);
});

test('Resend sends text plus HTML unchanged without attachments or recipient information in HTML', async () => {
  const message = challengeMail('device', '123456', 'synthetic-device');
  let body;
  const mailer = createMailer({ mailTransport: 'resend', mailFrom: 'sender@example.com', resendApiKey: 'fixture-key' }, {
    fetchImpl: async (_, options) => {
      body = JSON.parse(options.body);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ id: 'synthetic-message' }));
    },
  });
  await mailer.send({ to: 'user@example.com', accountId: 'synthetic-account', ...message });
  assert.deepEqual(body, { from: 'sender@example.com', to: ['user@example.com'], ...message });
  assert.doesNotMatch(body.html, /user@example.com|synthetic-account/);
});

test('optional HTML validates UTF-8 byte limits before file writes or provider calls', async () => {
  const message = { to: 'user@example.com', subject: 'synthetic', text: 'text' };
  for (const mailTransport of ['file', 'resend']) {
    let calls = 0;
    const mailer = createMailer({ mailTransport, mailFrom: 'sender@example.com', resendApiKey: 'fixture-key' }, {
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ id: 'fixture' })); },
    });
    for (const html of [null, 1, {}, Buffer.from('html'), 'a'.repeat(MAX_MAIL_HTML_BYTES + 1), '你'.repeat(21846)]) {
      await assert.rejects(mailer.send({ ...message, html }), /Mail HTML/);
    }
    assert.equal(calls, 0);
    if (mailTransport === 'resend') {
      await mailer.send({ ...message, html: 'a'.repeat(MAX_MAIL_HTML_BYTES) });
      await mailer.send({ ...message, html: '' });
      assert.equal(calls, 2);
    }
  }
});
