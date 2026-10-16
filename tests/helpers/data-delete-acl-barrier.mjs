import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

// Run the unchanged HTTP owner/desktop/A-B/cold-start scenario. A delayed Windows
// ACL result for a newly created sync file must not hold erasure open. Directory
// protection still executes normally; no permission result is fabricated.
let armed = false, polls = 0, released = false;
const pending = [];
const release = () => {
  released = true;
  for (const callback of pending.splice(0)) callback();
};
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
  const target = options?.env?.WEFTMATE_PRIVATE_ACL_TARGET;
  const hold = armed && options?.env?.WEFTMATE_PRIVATE_ACL_KIND === 'file' &&
    /(?:^|[\\/])weftmate-st4-host-/.test(target ?? '') &&
    /^events\.json(?:\..+\.tmp)?$/.test(path.basename(target ?? ''));
  return originalExecFile.call(this, file, args, options, (error, stdout, stderr) => {
    if (hold && !released) {
      process.stderr.write('DATA_DELETE_435 file ACL result held\n');
      pending.push(() => callback(error, stdout, stderr));
    } else callback(error, stdout, stderr);
  });
};
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const route = new URL(typeof input === 'string' ? input : input.url).pathname;
  if (route === '/personal/v1/data/confirm' && options?.headers?.['x-weftmate-desktop']) {
    armed = true;
    process.stderr.write('DATA_DELETE_435 barrier armed\n');
  }
  const response = await originalFetch(input, options);
  if (armed && route === '/personal/v1/data/operations' && ++polls === 200) {
    // The server has already serialized the final original-budget observation.
    // Release only now so the failed scenario can close its own store normally.
    process.stderr.write('DATA_DELETE_435 original 200 polls exhausted\n');
    release();
  }
  return response;
};
