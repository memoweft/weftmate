/** Static, public account shell. All account data comes from authenticated API calls. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { uiCoreAssets } from '../ui-core/manifest.mjs'

const files = new Map([
  ['/personal/v1/ui/backup.css', ['backup.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/backup.js', ['components/backup.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/motion.js', ['motion.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/popovers.js', ['popovers.js', 'text/javascript; charset=utf-8']],
  ...uiCoreAssets.map(name => [`/personal/v1/ui/ui-core/${name}`, [`../ui-core/${name}`, 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/components/steps.js', ['components/steps.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/artifacts.js', ['components/artifacts.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/context.js', ['components/context.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/auth.js', ['components/auth.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/cloud-settings.js', ['components/cloud-settings.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/legal/terms-zh.md', ['legal/terms-zh.md', 'text/plain; charset=utf-8']],
  ['/personal/v1/ui/legal/privacy-zh.md', ['legal/privacy-zh.md', 'text/plain; charset=utf-8']],
  ['/personal/v1/ui/components/shell.js', ['components/shell.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/composer.js', ['components/composer.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/messages.js', ['components/messages.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/resources.js', ['components/resources.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/sessions.js', ['components/sessions.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/approvals.js', ['components/approvals.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/usage.js', ['components/usage.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/usage.css', ['usage.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/settings.js', ['components/settings.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/account.js', ['components/account.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/memory.js', ['components/memory.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/attachments.js', ['components/attachments.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/questions.js', ['components/questions.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/tasks.js', ['components/tasks.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/phone.js', ['components/phone.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/markup.js', ['components/markup.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/layout.js', ['layout.js', 'text/javascript; charset=utf-8']],

  ['/personal/v1/ui/icons.js', ['icons.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/icons.svg', ['icons.svg', 'image/svg+xml']],
  ['/personal/v1/ui/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/personal/v1/ui/brand/color-light.svg', ['brand/color-light.svg', 'image/svg+xml']],
  ['/personal/v1/ui/brand/color-dark.svg', ['brand/color-dark.svg', 'image/svg+xml']],
  ['/personal/v1/ui/native-desktop.js', ['native-desktop.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/native-desktop.css', ['native-desktop.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/desktop.js', ['desktop.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/format-vendor.js', ['format-vendor.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/cloud-ui.js', ['cloud-ui.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/cloud-login.js', ['cloud-login.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/cloud-vendor.js', ['cloud-vendor.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/timeline.js', ['timeline.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui', ['index.html', 'text/html; charset=utf-8']],
  ['/personal/v1/ui/', ['index.html', 'text/html; charset=utf-8']],
  ['/personal/v1/ui/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/personal/v1/ui/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/tokens.css', ['tokens.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/file-sha256.js', ['file-sha256.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/vendor/noble-hashes-2.3.0/sha2.js', ['vendor/noble-hashes-2.3.0/sha2.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/vendor/noble-hashes-2.3.0/_md.js', ['vendor/noble-hashes-2.3.0/_md.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/vendor/noble-hashes-2.3.0/_u64.js', ['vendor/noble-hashes-2.3.0/_u64.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/vendor/noble-hashes-2.3.0/utils.js', ['vendor/noble-hashes-2.3.0/utils.js', 'text/javascript; charset=utf-8']],
])

export const personalAccessUiAssetPaths = new Set(files.keys())

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
}

export async function servePersonalAccessUi(request, response, cloud = null) {
  if (request.method !== 'GET' || typeof request.url !== 'string') return false
  let url
  try { url = new URL(request.url, 'http://127.0.0.1') } catch { return false }
  if (url.search || url.pathname.includes('%')) return false
  const asset = files.get(url.pathname)
  if (!asset) return false
  try {
    const body = await readFile(join(import.meta.dirname, asset[0]))
    const headers = { ...securityHeaders };
    if (cloud?.issuer) headers['content-security-policy'] = headers['content-security-policy']
      .replace("connect-src 'self'", `connect-src 'self' ${new URL(cloud.issuer).origin}`);
    response.writeHead(200, { ...headers, 'content-type': asset[1], 'content-length': String(body.length) })
    response.end(body)
  } catch {
    response.writeHead(503, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' })
    response.end('Account page unavailable')
  }
  return true
}
