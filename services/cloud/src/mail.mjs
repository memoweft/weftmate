import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

// Provider implementations implement send({ to, subject, text }) -> { id }.
export function createMailer(config, { logger, fetchImpl = fetch } = {}) {
  if (!['file', 'resend'].includes(config.mailTransport))
    throw new Error('Mail provider is not implemented');
  if (config.mailTransport === 'resend' && (!config.resendApiKey || !config.mailFrom))
    throw new Error('Resend is not configured');
  return {
    async send({ to, subject, text }) {
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
      if (config.mailTransport === 'resend') {
        const id = randomUUID();
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.resendApiKey}`,
            'content-type': 'application/json',
            'idempotency-key': id,
          },
          body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
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
      const handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify(
            { id, from: config.mailFrom, to, subject, text, createdAt: new Date().toISOString() },
            null,
            2,
          ) + '\n',
        );
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(file, { force: true });
        throw error;
      }
      await handle.close();
      logger?.info('mail.written', { id, transport: 'file' });
      return { id };
    },
  };
}
