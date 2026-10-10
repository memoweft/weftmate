import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rm, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const MAX_MAIL_HTML_BYTES = 64 * 1024;

// Provider implementations implement send({ to, subject, text, html? }) -> { id }.
export function createMailer(config, { logger, fetchImpl = fetch } = {}) {
  if (!['file', 'resend'].includes(config.mailTransport))
    throw new Error('Mail provider is not implemented');
  if (config.mailTransport === 'resend' && (!config.resendApiKey || !config.mailFrom))
    throw new Error('Resend is not configured');
  return {
    async prune(now = Date.now()) {
      if (config.mailTransport !== 'file') return;
      const names = await readdir(config.mailDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const name of names.filter(n => /^[a-f0-9-]+\.json$/.test(n))) {
        const file = path.join(config.mailDir, name);
        const source = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (source === null) continue;
        const mail = JSON.parse(source);
        if (Date.parse(mail.createdAt) <= now - 3600000) await rm(file, { force: true });
      }
    },
    async deleteAccount(accountId, emails = []) {
      if (config.mailTransport !== 'file') return;
      const names = await readdir(config.mailDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const name of names.filter(n => /^[a-f0-9-]+\.json$/.test(n))) {
        const file = path.join(config.mailDir, name);
        const source = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (source === null) continue;
        const mail = JSON.parse(source);
        if (mail.accountId === accountId || !mail.accountId && emails.includes(mail.to)) await rm(file, { force: true });
      }
    },
    async send({ to, subject, text, html, accountId }) {
      if (
        typeof to !== 'string' ||
        !to.trim() ||
        /[\r\n]/.test(to) ||
        typeof subject !== 'string' ||
        !subject.trim() ||
        /[\r\n]/.test(subject) ||
        typeof text !== 'string'
      ) {
        throw new TypeError('Mail requires a recipient, single-line subject, and text body');
      }
      if (html !== undefined && (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_MAIL_HTML_BYTES)) {
        throw new TypeError('Mail HTML must be a string of at most 65536 UTF-8 bytes');
      }
      const htmlBody = html === undefined ? {} : { html };
      if (config.mailTransport === 'resend') {
        const id = randomUUID();
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.resendApiKey}`,
            'content-type': 'application/json',
            'idempotency-key': id,
          },
          body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, ...htmlBody }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('MAIL_DELIVERY_FAILED');
        }
        const result = await response.json();
        if (typeof result.id !== 'string') throw new Error('MAIL_DELIVERY_FAILED');
        logger?.info('mail.accepted', { id, transport: 'resend' });
        return { id: result.id };
      }
      await mkdir(config.mailDir, { recursive: true, mode: 0o700 });
      await chmod(config.mailDir, 0o700);
      const id = randomUUID();
      const file = path.join(config.mailDir, `${id}.json`);
      const staging = `${file}.tmp`;
      const handle = await open(staging, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify(
            { id, from: config.mailFrom, to, subject, text, ...htmlBody, ...(accountId ? { accountId } : {}), createdAt: new Date().toISOString() },
            null,
            2,
          ) + '\n',
        );
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(staging, { force: true });
        throw error;
      }
      await handle.close();
      await rename(staging, file);
      logger?.info('mail.written', { id, transport: 'file' });
      return { id };
    },
  };
}
