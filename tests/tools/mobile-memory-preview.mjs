import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const prefix = '/personal/v1/__fixture/mobile';
const bridgePath = '/personal/v1/__fixture/mobile-bridge.js';
const nativeCallPath = '/personal/v1/__fixture/mobile-native';
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};

function jsonScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function bridgeScript() {
  return `(()=>{const deliver=(value)=>window.weftNative?.onmessage?.({data:JSON.stringify(value)});window.weftNative={onmessage:null,__deliver:deliver,postMessage(raw){let request;try{request=JSON.parse(raw)}catch{return}const script=document.createElement('script');script.async=true;script.src='${nativeCallPath}?data='+encodeURIComponent(raw);script.onerror=()=>deliver({id:request.id,ok:false,error:{code:'NATIVE_UNAVAILABLE'}});document.head.appendChild(script)}}})()`;
}

function rewriteIndex(html) {
  let page = html
    .replace('href="styles.css"', `href="${prefix}/styles.css"`)
    .replace('src="vendor.js"', `src="${prefix}/vendor.js"`)
    .replace('src="app.js"', `src="${prefix}/app.js"`);
  page = page.replace(`<script defer src="${prefix}/vendor.js"></script>`,
    `<script defer src="${bridgePath}"></script><script defer src="${prefix}/vendor.js"></script>`);
  return page;
}

function scopeFor(origin, ownerId) {
  return createHash('sha256').update(`${origin}|${ownerId}`).digest('hex');
}

function safeProfile(session, origin) {
  return { owner: scopeFor(origin, session.ownerId), username: session.username || '合成账户',
    displayName: session.displayName || session.username || '合成账户', connectionVerified: true,
    backgroundSync: 'scheduled', avatar: null };
}

async function writeScript(response, value) {
  response.writeHead(200, { ...securityHeaders, 'content-type': contentTypes.get('.js') });
  response.end(`window.weftNative?.__deliver(${jsonScript(value)});`);
}

/**
 * Mounts the candidate mobile page and its synthetic native bridge on the shared
 * loopback fixture. `resolveSession` returns the fixture account for the request's
 * cookie; `readMemory` dispatches only authenticated synthetic GETs through the
 * fixture's existing memory handler.
 */
export async function handleMobileMemoryPreview(request, response, {
  root,
  origin,
  resolveSession,
  readMemory,
}) {
  if (!root || !origin || typeof resolveSession !== 'function' || typeof readMemory !== 'function') return false;
  const expectedHost = new URL(origin).host;
  if (request.headers.host !== expectedHost ||
      (request.headers.origin !== undefined && request.headers.origin !== origin)) {
    response.writeHead(403, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
    response.end('fixture origin rejected');
    return true;
  }
  let url;
  try { url = new URL(request.url ?? '/', origin); } catch { return false; }

  if ((url.pathname === `${prefix}` || url.pathname === `${prefix}/`) && request.method === 'GET' && !url.search) {
    try {
      const html = rewriteIndex(await readFile(join(root, 'index.html'), 'utf8'));
      response.writeHead(200, { ...securityHeaders, 'content-type': contentTypes.get('.html') });
      response.end(html);
    } catch {
      response.writeHead(503, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
      response.end('Candidate mobile page unavailable');
    }
    return true;
  }
  if (url.pathname === bridgePath && request.method === 'GET' && !url.search) {
    response.writeHead(200, { ...securityHeaders, 'content-type': contentTypes.get('.js') });
    response.end(bridgeScript());
    return true;
  }
  if (url.pathname.startsWith(`${prefix}/`) && request.method === 'GET' && !url.search) {
    const relative = url.pathname.slice(prefix.length + 1);
    const allowed = relative === 'styles.css' || relative === 'app.js' || relative === 'vendor.js' ||
      /^icons\/[A-Za-z0-9._-]+\.svg$/.test(relative) || /^brand\/[A-Za-z0-9._-]+\.svg$/.test(relative);
    if (!allowed) return false;
    const target = resolve(root, relative);
    if (!target.startsWith(`${resolve(root)}${sep}`)) return false;
    try {
      const body = await readFile(target);
      response.writeHead(200, { ...securityHeaders,
        'content-type': contentTypes.get(extname(target).toLowerCase()) || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
      response.end('Candidate mobile asset unavailable');
    }
    return true;
  }
  if (url.pathname !== nativeCallPath || request.method !== 'GET' || !url.searchParams.has('data')) return false;

  let rpc;
  try {
    const encoded = url.searchParams.get('data');
    if (!encoded || Buffer.byteLength(encoded, 'utf8') > 8 * 1024) throw new Error('INVALID_REQUEST');
    rpc = JSON.parse(encoded);
    if (!rpc || typeof rpc.id !== 'string' || typeof rpc.method !== 'string' || !rpc.params || typeof rpc.params !== 'object')
      throw new Error('INVALID_REQUEST');
  } catch {
    response.writeHead(400, { ...securityHeaders, 'content-type': 'text/javascript; charset=utf-8' });
    response.end("window.weftNative?.__deliver({ok:false,error:{code:'INVALID_REQUEST'}});");
    return true;
  }

  try {
    const session = await resolveSession(request);
    const profile = session ? safeProfile(session, origin) : null;
    let result;
    switch (rpc.method) {
      case 'events.subscribe': result = {}; break;
      case 'app.bootstrap': result = { loggedIn: !!profile, username: profile?.username || '', owner: profile?.owner || '',
        model: null, busy: false, ui: null, backgroundSync: profile ? 'scheduled' : 'unknown' }; break;
      case 'app.ready':
      case 'app.activity':
      case 'settings.appearance': result = rpc.method === 'settings.appearance' ? { value: 'system' } : {}; break;
      case 'conversations.list': result = { conversations: [] }; break;
      case 'conversations.messages': result = { messages: [], receipts: [] }; break;
      case 'auth.me':
        if (!profile) throw new Error('LOGIN_REQUIRED');
        result = profile;
        break;
      case 'auth.state': result = { configured: true, registrationAvailable: true }; break;
      case 'host.business':
        if (!session || !profile) throw new Error('LOGIN_REQUIRED');
        if (rpc.params.method !== 'GET' || typeof rpc.params.path !== 'string' ||
            !rpc.params.path.startsWith('/personal/v1/memory/')) throw new Error('METHOD_NOT_ALLOWED');
        result = await readMemory(request, rpc.params.path);
        break;
      default: throw new Error('PREVIEW_METHOD_UNAVAILABLE');
    }
    await writeScript(response, { id: rpc.id, ok: true, result });
  } catch (error) {
    const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'OPERATION_FAILED';
    await writeScript(response, { id: rpc.id, ok: false, error: { code } });
  }
  return true;
}
