import { loadConfig } from './config.mjs';
import { openDatabase } from './database.mjs';
import { createLogger } from './log.mjs';
import { createMailer } from './mail.mjs';
import { createCloudServer } from './server.mjs';
import { createIdentity } from './identity.mjs';
import { dnsFromEnvironment } from './dns-aliyun.mjs';

// WAL sidecars and any future service files inherit private permissions.
process.umask(0o077);
const logger = createLogger();
let database;
let server;
let relay;
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('service.stopping', { signal });
  await relay?.close();
  server.close(() => {
    database.close();
    logger.info('service.stopped');
  });
  server.closeIdleConnections();
}

try {
  const config = loadConfig();
  const opened = await openDatabase(config.databasePath);
  database = opened.database;
  const mailer = createMailer(config, { logger });
  const identity = await createIdentity({ database, config, mailer, logger, relayDns: dnsFromEnvironment({ database }) });
  relay = identity.relay;
  await relay.start();
  server = createCloudServer({ ...opened, logger, identity });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', (error) => {
    logger.error('service.error', { code: error.code ?? 'SERVER_ERROR' });
    process.exitCode = 1;
    shutdown('server-error');
  });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  logger.info('service.started', {
    port: server.address().port,
    schemaVersion: opened.schemaVersion,
  });
} catch (error) {
  await relay?.close();
  database?.close();
  logger.error('service.start_failed', { code: error.code ?? 'STARTUP_FAILED' });
  process.exitCode = 1;
}
