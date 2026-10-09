import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { productionEnvironment, saveDesktopConfig } from '../src/desktop-config.mjs';

/** Parse only literal deployment values; never execute the source task script. */
export async function productionConfigFromTask({ sourceTaskScript, dataDirectory, rehearsal = false }) {
  const text = await readFile(sourceTaskScript, 'utf8');
  const repository = dirname(dirname(resolve(sourceTaskScript)));
  const literal = variable => new RegExp(`\\$${variable}\\s*=\\s*'([^']+)'`, 'i').exec(text)?.[1];
  const runtime = literal('runtime');
  const profile = /\$profile\s*=\s*Join-Path\s+\$runtime\s+'([^']*personal-account[^']*)'/i.exec(text)?.[1];
  const port = [...text.matchAll(/\$port\s*=\s*'(\d+)'/g)].at(-1)?.[1];
  const publicOrigin = /'--public-origin'\s*,\s*'([^']+)'/.exec(text)?.[1];
  if (!runtime || !profile || !port || !publicOrigin) throw new Error('SOURCE_PRODUCTION_PARAMETERS_NOT_RECOGNIZED');
  const pathOption = variable => [...text.matchAll(new RegExp(`\\$${variable}\\s*=\\s*Join-Path\\s+\\$runtime\\s+'([^']+)'`, 'gi'))].at(-1)?.[1];
  const production = {};
  for (const [key, envName] of Object.entries(productionEnvironment)) {
    const direct = new RegExp(`\\$env:${envName}\\s*=\\s*'([^']*)'`).exec(text)?.[1];
    const relative = new RegExp(`\\$env:${envName}\\s*=\\s*Join-Path\\s+\\$repository\\s+'([^']+)'`).exec(text)?.[1];
    if (direct !== undefined) production[key] = /^(true|false)$/.test(direct) ? direct === 'true' : direct;
    else if (relative) production[key] = join(repository, relative);
  }
  const result = { schemaVersion: 1, dataDirectory: resolve(dataDirectory || join(runtime, profile)), accessPort: Number(port),
    publicOrigin, trustLoopbackProxy: true, production, mobileUiDirectory: join(runtime, pathOption('mobileUi')),
    personalMemoryConfig: join(runtime, pathOption('memoryConfig')), androidPackagePath: join(runtime, pathOption('androidPackage')),
    updates: { channel: 'stable', baseUrl: 'https://weftmate.com/updates/windows/x64/' } };
  if (rehearsal) {
    result.accessPort = 0; delete result.publicOrigin; delete result.trustLoopbackProxy;
    delete result.mobileUiDirectory; delete result.personalMemoryConfig; delete result.androidPackagePath;
    result.production = { relayEnabled: false, acmeEnabled: false };
    result.updates = { channel: 'stable' };
  }
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i+1];
  const config = await productionConfigFromTask({ sourceTaskScript: options.source, dataDirectory: options.data, rehearsal: options.rehearsal === 'true' });
  if (options.port) config.accessPort = Number(options.port);
  saveDesktopConfig(resolve(options.output), config);
  console.log('Production configuration written; account credentials remain in their existing data directory.');
}
