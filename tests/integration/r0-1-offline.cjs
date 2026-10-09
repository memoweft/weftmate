/* Test-only network boundary, inherited by the real DSH child during the private-data rehearsal. */
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof input === 'object' ? input : { port: input, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!options?.path && (!['localhost', '127.0.0.1', '::1', undefined].includes(options?.host) || [8081,18186].includes(Number(options?.port))))
    throw new Error('R01_REHEARSAL_NETWORK_BLOCKED');
  return original.apply(this, args);
};
