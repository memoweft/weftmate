// A test-only tripwire: routine CSR coverage must use its fixed sample, not
// accidentally select the exhaustive random sweep. No real OpenSSL is started
// when the old random case is reached.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const generateKeyPairSync = crypto.generateKeyPairSync;
crypto.generateKeyPairSync = function(type, ...args) {
  if (type === 'ec') throw new Error('Exhaustive random EC sweep selected by routine CSR discovery');
  return generateKeyPairSync.call(this, type, ...args);
};
syncBuiltinESMExports();
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => {
  if (error.code !== 'EPIPE') throw error;
});
