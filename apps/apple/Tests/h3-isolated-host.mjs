// Real personal-access + H2 health store; a synthetic empty backend avoids loading DSH or any model.
// Runtime directory and credentials never enter evidence or Git.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'weftmate-h3-host-')));
const service = await createPersonalAccessService({ root, port: 0, backend: {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }), listModels: async () => [],
  readEvents: async ({ afterSeq }) => ({ events: [], nextSeq: afterSeq, hasMore: false }),
  describeSession: async () => null,
  preflight: async () => ({ ok: true }), createSession: async () => { throw new Error('No synthetic model'); },
  sendMessage: async () => { throw new Error('No synthetic model'); }, cancelSession: async () => ({ accepted: true }),
} });
const { origin } = await service.start();
console.log(JSON.stringify({ origin, root }));
process.on('SIGTERM', async () => { await service.close(); await rm(root, { recursive: true, force: true }); process.exit(0); });
