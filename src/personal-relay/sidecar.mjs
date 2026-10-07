// The IPC channel closes even if the Electron/Node host crashes. Keep frpc tied
// to the host lifetime without relying on Unix process groups or Windows taskkill.
import { spawn } from 'node:child_process';
const [binary, configFile] = process.argv.slice(2);
if (!process.connected || !binary || !configFile) throw new Error('Sidecar requires a parent IPC channel');
const child = spawn(binary, ['-c', configFile], { stdio: 'ignore', windowsHide: true });
let stopping = false, timer;
function stop() {
  if (stopping) return; stopping = true;
  child.kill('SIGTERM');
  timer = setTimeout(() => child.kill('SIGKILL'), 2000);
}
process.on('disconnect', stop);
process.on('message', message => { if (message?.kind === 'stop') stop(); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.once('error', () => { process.exitCode = 1; process.disconnect(); });
child.once('exit', code => { clearTimeout(timer); process.exitCode = stopping ? 0 : code ?? 1; if (process.connected) process.disconnect(); });
