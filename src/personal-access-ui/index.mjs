/** Static, public account shell. All account data comes from authenticated API calls. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { uiCoreBrowserAssets as uiCoreAssets, uiCoreSourceAsset } from '../ui-core/manifest.mjs'
import renderAssets from './render-assets.json' with {type: 'json'};

const files = new Map([
  ...['panels/terminal.js', 'panels/terminal.css', 'vendor/terminal/xterm.js', 'vendor/terminal/addon-fit.js', 'vendor/terminal/xterm.css'].map(name =>
    [`/personal/v1/ui/${name}`, [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/pages.css', ['pages.css','text/css; charset=utf-8']],
  ['/personal/v1/ui/components/computers.js', ['components/computers.js','text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/work-and-chat.js', ['components/work-and-chat.js','text/javascript; charset=utf-8']],
  ['/personal/v1/ui/work-and-chat.css', ['work-and-chat.css','text/css; charset=utf-8']],
  ['/personal/v1/ui/computer-channel.html', ['computer-channel.html','text/html; charset=utf-8']],
  ['/personal/v1/ui/computer-channel.js', ['computer-channel.js','text/javascript; charset=utf-8']],
  ...['history-import-view.js','history-import.css'].map(name => [`/personal/v1/ui/${name}`, [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/mobile-refresh.css', ['mobile-refresh.css','text/css; charset=utf-8']],
  ['/personal/v1/ui/mobile-refresh.js', ['mobile-refresh.js','text/javascript; charset=utf-8']],
  ...['phone-unify.js','phone-files.js','phone-pdf.js','phone-unify.css','phone-files.css'].map(name => [`/personal/v1/ui/${name}`, [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/permission.css', ['permission.css','text/css; charset=utf-8']],
  ['/personal/v1/ui/components/data.js', ['components/data.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/data.css', ['data.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/help.css', ['help.css','text/css; charset=utf-8']],
  ...['components/help-view.js','components/help.js'].map(name => [`/personal/v1/ui/${name}`, [name,'text/javascript; charset=utf-8']]),
  ...['components/presence.js','presence.css'].map(name => [`/personal/v1/ui/${name}`, [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/search.css', ['search.css', 'text/css; charset=utf-8']],
  ...['components/search-view.js','components/search.js'].map(name => [`/personal/v1/ui/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/folder-choice.js', ['folder-choice.js','text/javascript; charset=utf-8']],
  ['/personal/v1/ui/folder-choice.css', ['folder-choice.css','text/css; charset=utf-8']],
  ...renderAssets.map(name => [`/personal/v1/ui/${name}`, [name, name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream']]),
  ['/personal/v1/ui/library.css', ['library.css', 'text/css; charset=utf-8']],
  ...['components/library-view.js','components/library.js'].map(name => [`/personal/v1/ui/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/goals.css', ['goals.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/health.css', ['health.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/health-view.js', ['components/health-view.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/health.js', ['components/health.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/goals-view.js', ['components/goals-view.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/goals.js', ['components/goals.js', 'text/javascript; charset=utf-8']],

  ...['components/onboarding.js'].map(name => [`/personal/v1/ui/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/onboarding.css', ['onboarding.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/activity.css', ['activity.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/activity-view.js', ['components/activity-view.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/activity.js', ['components/activity.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/message-actions.js', ['message-actions.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/message-actions.css', ['message-actions.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/controls.css', ['controls.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/main-chat.js', ['components/main-chat.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/chat-process.css', ['chat-process.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/main-chat.css', ['main-chat.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/composer-subtasks.js', ['composer-subtasks.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/next-suggestions.js', ['next-suggestions.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/next-suggestions.css', ['next-suggestions.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/composer-extras.css', ['composer-extras.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/offline.css', ['offline.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/offline.js', ['components/offline.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/conversation-scroll.js', ['conversation-scroll.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/backup.css', ['backup.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/components/backup.js', ['components/backup.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/motion.js', ['motion.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/popovers.js', ['popovers.js', 'text/javascript; charset=utf-8']],
  ...uiCoreAssets.map(name => [`/personal/v1/ui/ui-core/${name}`, [`../ui-core/${uiCoreSourceAsset(name)}`, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
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
  ['/personal/v1/ui/components/schedules.js', ['components/schedules.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/components/usage.js', ['components/usage.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/usage.css', ['usage.css', 'text/css; charset=utf-8']],
  ...['components/notifications.js', 'components/question-bar.js', 'components/personalization.js', 'components/settings-controls.js', 'components/settings-appearance.js', 'components/settings-navigation.js'].map(name => [`/personal/v1/ui/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ['/personal/v1/ui/personalization.css', ['personalization.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/settings.css', ['settings.css', 'text/css; charset=utf-8']],
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
  ['/personal/v1/ui/panels/review.js', ['panels/review.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/panels/terminal.js', ['panels/terminal.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/panels/browser.js', ['panels/browser.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/panels/browser.css', ['panels/browser.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/panels/files.js', ['panels/files.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/panels/chat.js', ['panels/chat.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/panels/subtasks.js', ['panels/subtasks.js', 'text/javascript; charset=utf-8']],
  ['/personal/v1/ui/workspace.css', ['workspace.css', 'text/css; charset=utf-8']],
  ['/personal/v1/ui/system-bars.js', ['system-bars.js', 'text/javascript; charset=utf-8']],
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

export const personalAccessUiAssetPaths = new Set([...files.keys(), '/personal/v1/ui/offline-worker.js'])
// Published keys follow browser URLs; source files may live outside ui-core.
const resourceName = (pathname, sourceName) => sourceName.startsWith('../ui-core/')
  ? pathname.slice('/personal/v1/ui/'.length) : `personal-access-ui/${sourceName}`;
export const personalAccessUiResources = new Map([...files].map(([pathname, [name]]) =>
  [resourceName(pathname, name), join(import.meta.dirname, name)]))
let verifiedResource = null
export function setPersonalAccessUiResourceReader(reader) { verifiedResource = reader }

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self' https: blob:; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; frame-src blob:",
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
  if (url.pathname === '/personal/v1/ui/offline-worker.js') {
    const assets = [...files.keys()].filter(name => name.startsWith('/personal/v1/ui/') && !name.endsWith('/'));
    const script = `const CACHE='weftmate-public-ui-m3a-v1',ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('weftmate-public-ui-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||u.search)return;const name=u.pathname==='/personal/v1/ui/'?'/personal/v1/ui/index.html':u.pathname;if(!ASSETS.includes(name))return;event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match(name))));});`;
    response.writeHead(200, { ...securityHeaders, 'content-type': 'text/javascript; charset=utf-8' }); response.end(script); return true;
  }
  const asset = files.get(url.pathname)
  if (!asset) return false
  try {
    const resource = resourceName(url.pathname, asset[0])
    let body = await verifiedResource?.(resource) ?? await readFile(join(import.meta.dirname, asset[0]))
    const headers = { ...securityHeaders };
    if (asset[0] === 'index.html') {
      const nonce = randomBytes(18).toString('base64');
      body = Buffer.from(body.toString().replace('__WEFT_STYLE_NONCE__', nonce));
      headers['content-security-policy'] = headers['content-security-policy'].replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);
    }
    if (url.pathname.endsWith('/computer-channel.html')) {
      delete headers['x-frame-options'];
      headers['content-security-policy'] = "default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'none'; object-src 'none'";
    } else headers['content-security-policy'] = headers['content-security-policy'].replace('frame-src blob:', 'frame-src blob: https: http://127.0.0.1:*');
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
