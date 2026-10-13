// Abrupt-host-exit fixture. All paths and credentials belong to the test scope.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createConnectors } from '../../../src/personal-connectors/index.mjs';
import { createConnectorVault } from '../../../src/personal-connectors/vault.mjs';
const [root, runtime, server] = process.argv.slice(2), values = new Map();
const vault = createConnectorVault({ getCredential: id => values.get(id) ?? null,
  saveCredential: (id, value) => values.set(id, value), removeCredential: id => values.delete(id),
  listCredentialIds: () => [...values.keys()] });
const manager = await createConnectors({ root, runtime, vault, startupMs: 3000, callMs: 60000 });
const connector = await manager.add('synthetic-owner', { name: '意外退出合成服务', transport: 'stdio',
  command: process.execPath, args: [server, root], credentials: { ST7A_STARTS: join(root, 'starts') } });
await manager.call('synthetic-owner', connector.id, connector.tools.find(tool => tool.rawName === 'read_note').name, {});
void manager.call('synthetic-owner', connector.id, connector.tools.find(tool => tool.rawName === 'slow_operation').name, {}).catch(() => {});
await new Promise(resolve => setTimeout(resolve, 50));
const serverPid=Number((await readFile(join(root,'starts'),'utf8')).trim().split('\n').at(-1));
const workerPid=Number(process.platform==='win32'
  ? execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write((Get-CimInstance Win32_Process -Filter 'ProcessId=${serverPid}').ParentProcessId)`],{encoding:'utf8',windowsHide:true})
  : execFileSync('ps',['-o','ppid=','-p',String(serverPid)],{encoding:'utf8'}));
process.send({ ready: true, workerPid });
