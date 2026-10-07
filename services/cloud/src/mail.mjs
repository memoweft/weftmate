import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

// Provider implementations implement send({ to, subject, text }) -> { id }.
// Registration/reset templates and delivery retries are S1, not S0.
export function createMailer(config, { logger } = {}) {
  if (config.mailTransport !== 'file') throw new Error('Mail provider is not implemented');
  return {
    async send({ to, subject, text }) {
      if (typeof to !== 'string' || !to.trim() || /[\r\n]/.test(to) ||
          typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || typeof text !== 'string') {
        throw new TypeError('Mail requires a recipient, single-line subject, and text body');
      }
      await mkdir(config.mailDir, { recursive: true, mode: 0o700 });
      await chmod(config.mailDir, 0o700);
      const id = randomUUID();
      const file = path.join(config.mailDir, `${id}.json`);
      const handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ id, from: config.mailFrom, to, subject, text,
          createdAt: new Date().toISOString() }, null, 2) + '\n');
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
