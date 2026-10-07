import path from 'node:path';

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const portText = env.CLOUD_PORT ?? '8787';
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(Number(portText)) || Number(portText) > 65535) {
    throw new Error('CLOUD_PORT must be an integer from 0 to 65535');
  }
  const host = env.CLOUD_HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('CLOUD_HOST must not be empty');
  const dataDirText = env.CLOUD_DATA_DIR ?? '.runtime';
  if (!dataDirText.trim()) throw new Error('CLOUD_DATA_DIR must not be empty');
  const dataDir = path.resolve(cwd, dataDirText);
  const mailTransport = env.CLOUD_MAIL_TRANSPORT ?? 'file';
  if (mailTransport !== 'file') throw new Error('Only the file mail transport is implemented in S0');
  const mailFrom = env.CLOUD_MAIL_FROM ?? 'WeftMate <no-reply@example.com>';
  if (!mailFrom.trim() || /[\r\n]/.test(mailFrom)) throw new Error('CLOUD_MAIL_FROM must be a single nonempty line');
  if (env.CLOUD_MAIL_DIR !== undefined && !env.CLOUD_MAIL_DIR.trim()) throw new Error('CLOUD_MAIL_DIR must not be empty');
  return Object.freeze({
    host, port: Number(portText), dataDir,
    databasePath: path.join(dataDir, 'cloud.sqlite'),
    mailTransport, mailFrom,
    mailDir: env.CLOUD_MAIL_DIR === undefined ? path.join(dataDir, 'mail-outbox') : path.resolve(cwd, env.CLOUD_MAIL_DIR),
  });
}
