// Starts the product's existing isolated Electron + secure DSH runtime.  This
// launcher deliberately does not start a raw DSH child: raw children cannot
// use WeftMate's credential IPC and would fall back to a file/env provider.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const take = name => {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  args.splice(index, 2)
  return value
}
const root = take('--root')
const memoryConfig = take('--memory-config') ?? take('--memoweft-config')
const port = take('--port')
const dryRun = args.includes('--dry-run')
if (dryRun) args.splice(args.indexOf('--dry-run'), 1)
if (port !== null) throw new Error('--port is not supported: the supervised product runtime uses an OS-assigned loopback port')
if (args.length) throw new Error(`unknown arguments: ${args.join(' ')}`)
if (!root) throw new Error('--root is required and must name an isolated dogfood data directory')
const isolatedRoot = resolve(root)
if (isolatedRoot === resolve(repository, 'dogfood', 'data', 'stage-1')) throw new Error('--root must not be the shared dogfood profile')
if (memoryConfig && !existsSync(resolve(memoryConfig))) throw new Error('--memory-config does not exist')
console.log('[dogfood-backend] isolatedRoot=' + isolatedRoot)
console.log('[dogfood-backend] memory=' + (memoryConfig ? 'configured-by-reference' : 'disabled'))
console.log('[dogfood-backend] model route, context window, and credentials are configured only through the product Settings UI and secure IPC')
const dogfoodScript = resolve(repository, 'dogfood', 'run.mjs')
const dogfoodArgs = ['--user-data-dir', isolatedRoot]
if (memoryConfig) dogfoodArgs.push('--memoweft-config', resolve(memoryConfig))
if (dryRun) { console.log('[dogfood-backend] dry-run command=' + JSON.stringify([process.execPath, dogfoodScript, ...dogfoodArgs])); process.exit(0) }

// Do not insert another Node process between the terminal and dogfood/run.
// The existing launcher owns stdin q/quit, SIGINT/SIGTERM, Electron IPC and
// the bounded Windows cleanup path.  Replacing argv before the dynamic import
// makes this wrapper only an argument-policy adapter, not a second lifecycle.
process.argv = [process.execPath, dogfoodScript, ...dogfoodArgs]
await import(pathToFileURL(dogfoodScript).href)
