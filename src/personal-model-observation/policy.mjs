import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

function within(root, path) {
  const suffix = relative(root, path)
  return suffix && !isAbsolute(suffix) && suffix !== '..' &&
    !suffix.startsWith(`..${sep}`) && !suffix.startsWith(`.${sep}`)
}

/** A test flag cannot silently attach the model relay to a daily profile. */
export function stage14R2ObservationProfile({ enabled, profile, repository, runId }) {
  if (enabled !== '1') return null
  if (!/^[0-9a-f-]{36}$/.test(runId ?? '')) throw new Error('invalid Stage14R2 run identity')
  const actual = realpathSync(profile)
  const acceptance = resolve(repository, '..', 'Runtime', 'UnifiedAssistant', 'Stage14R2Acceptance-20261004')
  const temp = realpathSync(tmpdir())
  const synthetic = within(temp, actual) && relative(temp, actual).split(sep)
    .some((part) => /^weftmate-synthetic-stop-stage11-[A-Za-z0-9-]{1,90}$/.test(part))
  if (!within(acceptance, actual) && !synthetic) throw new Error('Stage14R2 observation requires an isolated profile')
  return { runId, profile: actual }
}
