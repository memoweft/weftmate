import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { moduleSpecifiers, stagePersonalPlugins } from './support/personal-plugins.ts'

test('personal fixture covers every relative import of desktop/preset and their transitive modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-plugin-closure-'))
  try {
    // Dependency coverage is required on clean CI too; resolving DSH is tested in vendor mode.
    const staged = stagePersonalPlugins(root, () => fileURLToPath(import.meta.url))
    const entries = ['weftmate-personal-desktop.mjs', 'weftmate-personal-desktop-preset.mjs']
    for (const entry of entries) assert.ok(staged.files.has(resolve('src/plugins', entry)))
    assert.ok(staged.files.has(resolve('src/plugins/personal-personalization.mjs')))
    assert.ok(staged.files.has(resolve('src/ui-core/personalization.js')))
    for (const [source, target] of staged.files) {
      const original = readFileSync(source, 'utf8')
      const copied = moduleSpecifiers(readFileSync(target, 'utf8'))
      for (const specifier of moduleSpecifiers(original).filter(item => item.name.startsWith('.'))) {
        const dependency = resolve(dirname(source), specifier.name)
        assert.ok(staged.files.has(dependency), `${source} -> ${specifier.name}`)
        assert.ok(copied.some(item => item.name.startsWith('file:') && fileURLToPath(item.name) === staged.files.get(dependency)), `${target} must point to the staged dependency`)
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('fixture dependency discovery includes side-effect imports, re-exports and dynamic imports', () => {
  const source = `import './side-effect.js'; export { a } from '../re-export.mjs';
    const lazy = import('./lazy.mjs'); const text = "from './not-an-import.mjs'";`
  assert.deepEqual(moduleSpecifiers(source).map(item => item.name), ['./side-effect.js', '../re-export.mjs', './lazy.mjs'])
})
