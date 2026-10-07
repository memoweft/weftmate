/** Offline, non-executable 8K recovery option. Never starts or stops NInfer. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const digest = (value) => createHash('sha256').update(value).digest('hex')
export function deriveLimited8kPlan(manifest) {
  const original = manifest?.original?.argv
  if (!Array.isArray(original) || original.length !== 26 ||
      manifest.original.pid !== 25644 || manifest.original.sessionId !== 0 ||
      original.filter((value) => value === '--max-context').length !== 1 ||
      original.filter((value) => value === '--kv-capacity').length !== 1) {
    throw new Error('ORIGINAL_ARGV_UNVERIFIED')
  }
  const context = original.indexOf('--max-context') + 1
  const capacity = original.indexOf('--kv-capacity') + 1
  if (original[context] !== '110592' || original[capacity] !== '110592' ||
      original[0] !== manifest.original.exe ||
      original.slice(-5).join('|') !== '--spec|mtp|--draft-tokens|3|--lm-head-draft') {
    throw new Error('ORIGINAL_ROUTE_CHANGED')
  }
  const limited = original.slice()
  limited[context] = '8192'
  limited[capacity] = '8192'
  const changes = limited.flatMap((value, index) => value === original[index] ? []
    : [{ index, flag: original[index - 1], from: original[index], to: value }])
  if (changes.length !== 2 || changes[0].flag !== '--max-context' ||
      changes[1].flag !== '--kv-capacity') throw new Error('LIMITED_DIFF_INVALID')
  return { schemaVersion: 1, kind: 'stage14r3-limited-8k-review-only',
    originalPid: manifest.original.pid, originalArgvSha256: digest(JSON.stringify(original)),
    limitedArgvSha256: digest(JSON.stringify(limited)), originalArgv: original,
    limitedArgv: limited, changes,
    configSha256: manifest.expectedConfigSha256,
    compatibility: { configuredDshContextWindow: 110592, configuredDshMaxTokens: 32768,
      temporaryRuntimeContext: 8192, temporaryRuntimeKvCapacity: 8192,
      dailyConversationReadyProven: false },
    executable: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, outputFile] = process.argv.slice(2)
  const acceptance = resolve(join(import.meta.dirname, '..', '..', '..', 'Runtime',
    'UnifiedAssistant', 'Stage14R3Acceptance-20261004'))
  if (!manifestFile || !outputFile ||
      resolve(manifestFile).toLowerCase() !== join(acceptance, basename(manifestFile)).toLowerCase() ||
      resolve(outputFile).toLowerCase() !== join(acceptance, basename(outputFile)).toLowerCase() ||
      !/^limited-8k-review-[0-9a-f-]{36}\.json$/.test(basename(outputFile))) {
    throw new Error('REVIEW_PATH_INVALID')
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''))
  const review = deriveLimited8kPlan(manifest)
  writeFileSync(outputFile, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`reviewFile=${outputFile} executable=false\n`)
}
