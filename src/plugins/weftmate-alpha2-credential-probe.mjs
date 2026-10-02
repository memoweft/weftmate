import { credentialRef } from '@deepseek-ai/dsh-credentials'
export const name = 'weftmate-alpha2-credential-probe'
export const inject = ['connection', 'credentials']
export function apply(ctx) {
  let state = { enabled: false, complete: false, environmentClear: process.env.WEFTMATE_ALPHA2_SCRUB_API_KEY === undefined }
  // The secure bootstrap removes every credential-like environment name by
  // design. This non-secret test switch therefore deliberately avoids those
  // words and proves the scrubber cannot be bypassed by the probe itself.
  if (process.env.WEFTMATE_ALPHA2_TEST_PROBE === '1') void (async () => {
    state = { enabled: true, complete: false, environmentClear: process.env.WEFTMATE_ALPHA2_SCRUB_API_KEY === undefined }
    if (!state.environmentClear) throw new Error('credential_environment_visible')
    const ref = credentialRef('WEFTMATE_ALPHA2_SYNTHETIC')
    await ctx.credentials.set(ref, 'synthetic-value')
    if ((await ctx.credentials.resolve(ref))?.value !== 'synthetic-value') throw new Error('resolve')
    await ctx.credentials.unset(ref)
    if (await ctx.credentials.resolve(ref)) throw new Error('unset')
    state = { enabled: true, complete: true, environmentClear: true }
  })().catch(() => { state = { enabled: true, complete: false, environmentClear: process.env.WEFTMATE_ALPHA2_SCRUB_API_KEY === undefined, error: 'credential_probe_failed' } })
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/weftmate/credential-probe', methods: ['GET'], requestBody: 'buffered', fetch: async () => Response.json(state) }), 'alpha2 credential probe')
}
