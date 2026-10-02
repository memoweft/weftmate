export const EXTERNAL_AGENT_TEMPLATE = Object.freeze({
  manifest: { entry: 'src/main.mjs', state: 'data/state.json', validate: 'selfTest', stateSchemaVersion: 1, ui: { assets: 'ui' } },
  files: {
    'src/logic.mjs': `export const initial = () => ({ cursor: 0, count: 0, log: [] }); export const advance = (state, label) => ({ ...state, cursor: state.cursor + 1, log: [...state.log, label].slice(-20) });`,
    'src/main.mjs': `import { initial, advance } from './logic.mjs';
export async function start(api) { const prior = await api.state.read() || initial(); await api.state.write(advance(prior, 'started')); }
export async function selfTest(api) { const state = await api.state.read() || initial(); await api.state.write({ ...advance(state, 'self-test'), validation: true }); return { ok: true, assertions: [{ id: 'external-agent-demo-project-test', passed: true }] }; }
export async function stop(api) { const state = await api.state.read() || initial(); await api.state.write({ ...state, checkpoint: 'clean-stop' }); }
export async function handleUi(api, request) { let state = await api.state.read() || initial(); if (request?.action === 'status') return state; if (request?.action === 'increment') state = advance({ ...state, count: state.count + 1 }, 'increment'); await api.state.write(state); return state; }
`,
    'ui/index.html': '<!doctype html><meta charset="utf-8"><title>持久计数器</title><link rel="stylesheet" href="./style.css"><main><h1>持久计数器</h1><button id="increment">加 1</button><output id="value">正在读取计数…</output></main><script defer src="./app.js"></script>',
    'ui/style.css': 'main { max-width: 38rem; margin: 1rem auto; font: 14px/1.5 system-ui, sans-serif; } button { margin-right: .5rem; } output { display: block; margin-top: 1rem; min-height: 1.5em; }',
    'ui/app.js': `let port, token, sequence = 0
const value = document.getElementById('value')
const send = action => {
  const requestId = 'request-' + (++sequence)
  if (!port || !token) { value.textContent = '正在连接…'; return }
  port.postMessage({ type: 'weftmate-mod-action', token, requestId, action })
}
window.addEventListener('message', event => {
  if (event.data?.type === 'weftmate-mod-init' && typeof event.data.token === 'string') {
    token = event.data.token
    parent.postMessage({ type: 'weftmate-mod-ready', token }, '*')
    return
  }
  if (event.data?.type !== 'weftmate-mod-connect' || event.data.token !== token || !event.ports[0]) return
  port = event.ports[0]
  port.onmessage = message => {
    const data = message.data
    if (data?.token !== token) return
    if (data?.type === 'weftmate-mod-result') value.textContent = '当前计数：' + (data.result?.count ?? '未知')
    if (data?.type === 'weftmate-mod-error') value.textContent = '操作失败：' + data.error
  }
  send('status')
})
document.getElementById('increment').onclick = () => send('increment')
`,
  },
})
