// Callers supply operational fields only. Never pass request headers, URLs,
// mail bodies, credentials, or arbitrary Error objects into this logger.
export function createLogger({ stream = process.stdout, now = () => new Date() } = {}) {
  function write(level, event, fields = {}) {
    stream.write(`${JSON.stringify({ ...fields, time: now().toISOString(), level, service: 'weftmate-cloud', event })}\n`);
  }
  return {
    info: (event, fields) => write('info', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
