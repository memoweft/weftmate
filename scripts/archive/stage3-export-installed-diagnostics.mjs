#!/usr/bin/env electron
/** Export a redacted diagnostic using the exact modules inside installed app.asar. */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, safeStorage } from 'electron'
import asarApi from '@electron/asar'

function option(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? '' : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`)
  return resolve(value)
}

function requireStage3Path(value, segment) {
  if (!new RegExp(`[\\\\/]WeftMate[\\\\/]Runtime[\\\\/]Stage3[\\\\/]${segment}`, 'i').test(value)) {
    throw new Error(`path is outside the Stage 3 isolated ${segment} root`)
  }
  return value
}

const installedRoot = requireStage3Path(option('--installed-root'), 'install')
const userData = requireStage3Path(option('--user-data-dir'), 'data')
const output = requireStage3Path(option('--output'), 'evidence')
const asar = join(installedRoot, 'resources', 'app.asar')
app.setPath('userData', userData)

async function run() {
  let exitCode = 0
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
    const inside = (path) => pathToFileURL(join(asar, path)).href
    const diagnostics = await import(inside('src/diagnostics-export.ts'))
    const settings = await import(inside('src/settings.ts'))
    const configStore = await import(inside('src/config-store.ts'))
    const routes = await import(inside('src/harness-model-routes.ts'))
    const migration = await import(inside('src/dsh-settings-migration.ts'))
    const publicSettings = settings.readProductSettings()
    const profiles = publicSettings.models.profiles.map((profile) => {
      const route = routes.routeForProfile(profile.id)
      const hasKey = [profile.id, route.apiKeyEnv, migration.officialCredentialRef(route.provider)]
        .some((ref) => !!configStore.getCredential(ref))
      return { ...profile, hasKey }
    })
    const active = profiles.find((profile) => profile.id === publicSettings.models.activeId) ?? null
    const packageJson = JSON.parse(asarApi.extractFile(asar, 'package.json').toString('utf8'))
    const result = diagnostics.buildRedactedDiagnostics({
      version: packageJson.version,
      settings: publicSettings,
      models: { profiles, activeId: publicSettings.models.activeId },
      configured: active?.hasKey === true,
      ready: false,
      packaged: true,
      safeStorageAvailable: true,
      update: { enabled: true, status: 'idle', version: null, error: null },
    })
    const serialized = `${JSON.stringify(result, null, 2)}\n`
    if (/apiKey|baseUrl|127\.0\.0\.1|D:[\\/]|C:[\\/]|Users[\\/]/i.test(serialized)) {
      throw new Error('diagnostic projection contains a forbidden field or path')
    }
    writeFileSync(output, serialized, { encoding: 'utf8', mode: 0o600 })
    console.log(JSON.stringify({ exported: true, version: result.app.version, protectedCredentialProfiles: result.security.protectedCredentialProfiles }))
  } catch {
    exitCode = 1
    console.error(JSON.stringify({ exported: false, error: 'installed diagnostics QA failed' }))
  } finally {
    app.exit(exitCode)
  }
}

app.whenReady().then(run).catch(() => app.exit(1))
