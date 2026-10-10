import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

test('defaults and relative paths use only the supplied cloud working directory', () => {
  const config = loadConfig({}, '/tmp/cloud-fixture');
  assert.equal(config.port, 8787);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.databasePath, path.resolve('/tmp/cloud-fixture/.runtime/cloud.sqlite'));
  assert.equal(config.mailDir, path.resolve('/tmp/cloud-fixture/.runtime/mail-outbox'));
  assert.equal(config.mailTransport, 'file');
});

test('environment overrides support isolated ephemeral listeners and independent outboxes', () => {
  const config = loadConfig(
    {
      CLOUD_HOST: 'localhost',
      CLOUD_PORT: '0',
      CLOUD_DATA_DIR: 'state',
      CLOUD_MAIL_DIR: 'mail',
      CLOUD_MAIL_FROM: 'Test <sender@example.com>',
    },
    '/tmp/cloud-fixture',
  );
  assert.equal(config.port, 0);
  assert.equal(config.host, 'localhost');
  assert.equal(config.dataDir, path.resolve('/tmp/cloud-fixture/state'));
  assert.equal(config.mailDir, path.resolve('/tmp/cloud-fixture/mail'));
  assert.equal(config.mailFrom, 'Test <sender@example.com>');
});

test('invalid configuration and unimplemented providers fail before startup', () => {
  for (const port of ['', '-1', '1.5', '65536', '1e3', ' 8787', 'NaN']) {
    assert.throws(() => loadConfig({ CLOUD_PORT: port }), /CLOUD_PORT/);
  }
  for (const key of ['CLOUD_HOST', 'CLOUD_DATA_DIR', 'CLOUD_MAIL_DIR', 'CLOUD_MAIL_FROM']) {
    assert.throws(() => loadConfig({ [key]: ' ' }));
  }
  assert.throws(() => loadConfig({ CLOUD_MAIL_FROM: 'a\nb' }), /CLOUD_MAIL_FROM/);
  assert.throws(() => loadConfig({ CLOUD_MAIL_TRANSPORT: 'resend' }), /Resend requires/);
});

test('OIDC issuer/registered public clients and explicit Resend configuration are validated', () => {
  for (const issuer of [
    'http://api.example.com/personal/v1/cloud/oidc',
    'https://api.example.com/wrong',
    'https://user:password@api.example.com/personal/v1/cloud/oidc',
    'https://api.example.com/personal/v1/cloud/oidc?x=1',
  ]) {
    assert.throws(() => loadConfig({ CLOUD_ISSUER: issuer }), /CLOUD_ISSUER/);
  }
  assert.throws(
    () =>
      loadConfig({
        CLOUD_OIDC_CLIENTS: JSON.stringify([
          {
            client_id: 'example',
            redirect_uris: ['https://example.com/cb'],
            client_secret: 'forbidden',
          },
        ]),
      }),
    /CLIENTS/,
  );
  assert.throws(
    () =>
      loadConfig({
        CLOUD_OIDC_CLIENTS: JSON.stringify([
          { client_id: 'example', redirect_uris: ['http://example.com/cb'] },
        ]),
      }),
    /CLIENTS/,
  );
  const config = loadConfig({
    CLOUD_ISSUER: 'https://api.example.com/personal/v1/cloud/oidc',
    CLOUD_MAIL_TRANSPORT: 'resend',
    CLOUD_MAIL_FROM: 'no-reply@example.com',
    CLOUD_RESEND_API_KEY: 'fixture-not-a-real-key',
  });
  assert.equal(config.audience, 'https://api.example.com/personal/v1/cloud');
  assert.equal(config.mailTransport, 'resend');
});
