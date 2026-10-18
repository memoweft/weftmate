/** Check the selected host's real Node fetch path without requesting a certificate. */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function checkRelayNetwork({ executable = process.execPath, useEnvProxy = false, env = process.env, timeoutMs = 20_000 } = {}) {
  const childEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  delete childEnv.NODE_USE_ENV_PROXY;
  if (useEnvProxy) childEnv.NODE_USE_ENV_PROXY = '1';
  const script = `const started=Date.now();fetch('https://acme-v02.api.letsencrypt.org/directory',{signal:AbortSignal.timeout(15000)}).then(r=>{console.log(JSON.stringify({node:process.versions.node,status:r.status,elapsedMs:Date.now()-started}));process.exitCode=r.ok?0:1;}).catch(e=>{console.log(JSON.stringify({node:process.versions.node,error:e.name,causeCode:e.cause?.code,elapsedMs:Date.now()-started}));process.exitCode=1;});`;
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-e', script], { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on('data', bytes => { output += bytes; });
    child.once('error', error => { clearTimeout(timer); settled = true; reject(error); });
    child.once('close', code => {
      clearTimeout(timer); if (settled) return;
      try { resolve({ useEnvProxy, exitCode: code, ...JSON.parse(output.trim()) }); }
      catch { resolve({ useEnvProxy, exitCode: code, error: 'ProbeDidNotComplete' }); }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
  const index = process.argv.indexOf('--desktop-executable');
  if (index >= 0 && (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))) throw Error('DesktopExecutableRequired');
  const result = await checkRelayNetwork({ executable: index >= 0 ? process.argv[index + 1] : process.execPath,
    useEnvProxy: process.argv.includes('--use-env-proxy') });
  console.log(JSON.stringify(result));
  process.exitCode = result.exitCode === 0 ? 0 : 1;
}
