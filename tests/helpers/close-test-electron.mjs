import assert from 'node:assert/strict';

// Observe the child before shutdown begins. app.close() also disconnects the
// Node debugger; app.exit() alone can leave that connection holding shutdown.
export async function closeTestElectron(app, drain) {
  const child = app.process();
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await app.evaluate(drain);
  await app.close();
  const exit = await exited;
  assert.equal(exit.code, 0, JSON.stringify(exit));
  assert.equal(exit.signal, null, JSON.stringify(exit));
}
