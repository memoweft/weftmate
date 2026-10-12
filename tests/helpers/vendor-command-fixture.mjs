// Only external Git/pnpm work is synthetic. Vendor filesystem operations run unchanged.
import childProcess from 'node:child_process'
import fs from 'node:fs'
import promises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

if (process.argv[1]?.endsWith('vendor-dsh.mjs')) {
const root = resolve(process.env.WEFTMATE_VENDOR_FIXTURE_ROOT)
const phase = process.env.WEFTMATE_VENDOR_FIXTURE_PHASE
const pin = JSON.parse(fs.readFileSync(process.env.WEFTMATE_DSH_PIN_FILE, 'utf8'))
const names = JSON.parse(process.env.WEFTMATE_VENDOR_FIXTURE_PACKAGES)
const inside = path => { const rel = relative(root, resolve(path)); return rel && !rel.startsWith('..') }
const record = (operation, path) => {
  if (!inside(path)) throw Error(`fixture refused external ${operation}`)
  fs.appendFileSync(join(root, 'operations.jsonl'), JSON.stringify({ operation, path: relative(root, path).replaceAll('\\', '/') }) + '\n')
}
for (const name of ['rm', 'rename', 'unlink', 'mkdir', 'mkdtemp', 'symlink', 'writeFile', 'open']) {
  const original = promises[name]
  promises[name] = async (...args) => {
    // symlink's first argument is its target; both paths must be isolated.
    record(name, args[0])
    if (name === 'rename' || name === 'symlink') record(`${name}-destination`, args[1])
    const result = await original(...args)
    if (name === 'writeFile' && phase === 'verify' && String(args[0]).endsWith('VENDOR-MANIFEST.json')) {
      await promises.unlink(join(dirname(args[0]), 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
    }
    return result
  }
}
const put = (path, text) => { record('synthetic-write', path); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text) }
childProcess.spawnSync = (command, args, options) => {
  const cwd = resolve(options.cwd || (command === 'git' && args[0] === '-C' ? args[1] : root))
  if (!inside(cwd)) throw Error('fixture refused external command cwd')
  const words = Array.isArray(args) && args.length ? args : String(command).split(' ')
  const commandText = `${command} ${words.join(' ')}`
  record('command', cwd)
  const ok = { status: 0, stdout: '11.7.0\n', stderr: '' }
  const fail = { status: 1, stdout: '', stderr: `synthetic ${phase} failure` }
  if (command === 'git') {
    if (args[0] === 'clone') {
      const checkout = args.at(-1)
      put(join(checkout, 'package.json'), JSON.stringify({ version: pin.packageVersion, packageManager: 'pnpm@11.7.0' }))
      for (const name of names) {
        const dir = join(checkout, 'vendor', name.split('/')[1])
        put(join(dir, 'package.json'), JSON.stringify({ name, version: pin.packageVersion, main: 'lib/bin.js' }))
        put(join(dir, 'lib/bin.js'), '// compiled synthetic entry\n')
      }
    }
    return ok
  }
  if (commandText.includes('run build') && phase === 'compile') return fail
  if (words.includes('install') && options.env.npm_config_modules_dir) {
    const configured = words.find(word => word.startsWith('--modules-dir='))?.split('=')[1] ?? options.env.npm_config_modules_dir
    const modules = resolve(cwd, configured)
    if (!inside(modules)) throw Error('fixture refused inherited modules-dir outside its sandbox')
    // Model the proven pnpm validateModules -> removeContentsOfDir2 path.
    if (modules !== join(cwd, 'node_modules')) {
      record('pnpm-inherited-modules-purge', modules)
      fs.rmSync(modules, { recursive: true, force: true })
    }
    assertInstallPath(`--lockfile-dir=${cwd}`, words)
    assertInstallPath(`--virtual-store-dir=${join(cwd, 'node_modules/.pnpm')}`, words)
  }
  if (commandText.includes('pack --pack-destination')) {
    const pkg = JSON.parse(fs.readFileSync(join(words[words.indexOf('--dir') + 1], 'package.json')))
    const dest = words[words.indexOf('--pack-destination') + 1]
    put(join(dest, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`), pkg.name)
  }
  if (commandText.includes('--node-linker=hoisted')) {
    for (const name of names) {
      put(join(cwd, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: pin.packageVersion, main: 'lib/bin.js' }))
      put(join(cwd, 'node_modules', name, 'lib/bin.js'), '// installed synthetic entry\n')
      if (phase === 'interrupt') process.exit(86)
      if (phase === 'assemble') return fail
    }
  }
  return ok
}
syncBuiltinESMExports()
}

function assertInstallPath(option, words) {
  if (!words.includes(option)) throw Error(`install must pin ${option}`)
}
