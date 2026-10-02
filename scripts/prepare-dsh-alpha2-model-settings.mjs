#!/usr/bin/env node
/** Prepare a non-secret model-provider overlay while the Alpha.2 candidate is stopped. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { prepareAlpha2OfflineSettings, ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION } from '../src/plugins/weftmate-alpha2-model-settings.mjs'

const usage = 'Usage: node scripts/prepare-dsh-alpha2-model-settings.mjs --home PATH --provider-json PATH\n'
const values = parseArgs({ options: { home: { type: 'string' }, 'provider-json': { type: 'string' }, help: { type: 'boolean' } }, strict: true }).values
if (values.help || values.home === undefined || values['provider-json'] === undefined) {
  process.stdout.write(usage)
  process.exitCode = values.help ? 0 : 2
} else {
  const home = resolve(values.home)
  const profile = join(home, 'profiles', 'weftmate-alpha2')
  const documentPath = join(profile, 'weftmate-alpha2-model-settings.json')
  const input = JSON.parse(await readFile(resolve(values['provider-json']), 'utf8'))
  let existing = { schemaVersion: ALPHA2_OFFLINE_SETTINGS_SCHEMA_VERSION, providers: {} }
  if (existsSync(documentPath)) existing = JSON.parse(await readFile(documentPath, 'utf8'))
  const prepared = prepareAlpha2OfflineSettings(input, existing)
  const documentText = `${JSON.stringify(prepared, null, 2)}\n`
  await mkdir(profile, { recursive: true })
  const suffix = `.tmp-${process.pid}`
  await writeFile(`${documentPath}${suffix}`, documentText, { encoding: 'utf8', mode: 0o600 })
  await rename(`${documentPath}${suffix}`, documentPath)
  process.stdout.write(JSON.stringify({ prepared: true, schemaVersion: prepared.schemaVersion, provider: input.provider, credentialRef: prepared.providers[input.provider]?.apiKeyEnv }) + '\n')
}
