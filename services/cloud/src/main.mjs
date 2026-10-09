import { loadConfig } from './config.mjs';
import { openDatabase } from './database.mjs';
import { createLogger } from './log.mjs';
import { createMailer } from './mail.mjs';
import { createCloudServer } from './server.mjs';
import { createIdentity } from './identity.mjs';
import { dnsFromEnvironment } from './dns-aliyun.mjs';
import { pruneEphemeral } from './maintenance.mjs';

// WAL sidecars and any future service files inherit private permissions.
process.umask(0o077);
const logger = createLogger();
let database;
let server;
let relay;
let stopping = false;
let maintenance;
let maintenanceWork = Promise.resolve();

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenance);
  await maintenanceWork;
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
  await pruneEphemeral(database, mailer);
  maintenance = setInterval(() => {
    maintenanceWork = maintenanceWork.then(() => pruneEphemeral(database, mailer))
      .catch(() => logger.error('service.cleanup_failed', { code: 'CLEANUP_FAILED' }));
  }, 60000);
  maintenance.unref();
  const identity = await createIdentity({ database, config, mailer, logger, relayDns: dnsFromEnvironment({ database, logger }) });
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
  clearInterval(maintenance);
  await maintenanceWork;
  await relay?.close();
  database?.close();
  logger.error('service.start_failed', { code: error.code ?? 'STARTUP_FAILED' });
  process.exitCode = 1;
}
