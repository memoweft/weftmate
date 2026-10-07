import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Stage the production plugins against the exact installed DSH instance. */
export function stagePersonalPlugins(root: string) {
  const file = join(root, 'weftmate-personal-desktop.mjs')
  const vendor = pathToFileURL(join(process.cwd(), 'vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href
  writeFileSync(file, readFileSync(join(process.cwd(), 'src/plugins/weftmate-personal-desktop.mjs'), 'utf8')
    .replace("from '@deepseek-ai/dsh-tools'", `from '${vendor}'`)
    .replace("from '@deepseek-ai/dsh-agent'", `from '${pathToFileURL(join(process.cwd(), "vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-agent/lib/index.js")).href}'`)
    .replace("from './personal-native-files.mjs'", `from '${pathToFileURL(join(process.cwd(), 'src/plugins/personal-native-files.mjs')).href}'`)
    .replace("from '../runtime/dsh-adapter/source-range.mjs'", `from '${pathToFileURL(join(process.cwd(), 'src/runtime/dsh-adapter/source-range.mjs')).href}'`))
  const preset = join(root, 'preset.mjs')
  writeFileSync(preset, readFileSync(join(process.cwd(), 'src/plugins/weftmate-personal-desktop-preset.mjs'), 'utf8'))
  return { plugin: pathToFileURL(file).href, preset: pathToFileURL(preset).href }
}
