// Served by the Mod host from the same exact loopback origin as DSH.  Keeping
// the shell in the client package means deployment and disposable previews
// copy it with the existing client asset bundle.
export const MOD_WINDOW_CSS = String.raw`:root{--bg-base:#F6F7F9;--surface:#FFF;--surface-2:#F1F3F6;--surface-3:#E9ECF1;--line:#E6E9EF;--line-strong:#D3D9E3;--ink-1:#181B21;--ink-2:#565F6E;--ink-3:#98A1B0;--brand-700:#1F49D6;--brand-600:#2E5BFF;--brand-100:#E9EFFF;--brand-50:#F3F6FF;--ok:#15803D;--warn:#B45309;--err:#DC2626;--font-sans:"MiSans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--font-num:"Inter","MiSans","PingFang SC",system-ui,sans-serif;--r-ctl:8px;--r-card:12px;--ease-out:cubic-bezier(.22,1,.36,1);--t-fast:120ms}body.dark{--bg-base:#0F1218;--surface:#161A22;--surface-2:#1C212B;--surface-3:#242B37;--line:#242B37;--line-strong:#333B4A;--ink-1:#E9ECF2;--ink-2:#A6AEBC;--ink-3:#6E7787;--brand-700:#8FA8FF;--brand-600:#6B8CFF;--brand-100:rgba(107,140,255,.16);--brand-50:rgba(107,140,255,.09);--ok:#4ADE80;--warn:#FBBF24;--err:#F87171}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:var(--font-sans);background:var(--bg-base);color:var(--ink-1);font-size:13px;line-height:1.55;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}.host-bar{height:36px;flex-shrink:0;display:flex;align-items:center;gap:9px;padding:0 14px;background:var(--surface);border-bottom:1px solid var(--line);font-size:11.5px;color:var(--ink-3)}.hb-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);animation:pulse 1.6s ease-in-out infinite}.host-bar[data-tone="warn"] .hb-dot{background:var(--warn)}.host-bar[data-tone="err"] .hb-dot{background:var(--err)}.host-bar[data-tone="neutral"] .hb-dot{background:var(--ink-2);animation:none}.host-bar.disconnected .hb-dot,.host-bar.stopped .hb-dot{background:var(--ink-3);animation:none}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}.host-bar b{color:var(--ink-2);font-weight:600}.hb-tag{font-size:10px;background:var(--surface-2);border:1px solid var(--line);border-radius:4px;padding:1px 7px;font-family:var(--font-num)}.host-bar a{margin-left:auto;font-size:11.5px;color:var(--brand-600);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px}.host-bar a:hover{color:var(--brand-700)}.mod-stage{position:relative;flex:1;min-height:0;background:var(--bg-base)}iframe{width:100%;height:100%;border:0;display:block;background:var(--bg-base)}.cover{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--bg-base) 84%,transparent)}.cover.show{display:flex}.cover-card{max-width:360px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:24px;color:var(--ink-2)}.cover-card h1{margin:0 0 6px;color:var(--ink-1);font-size:16px}.cover-card p{margin:0}.cover-card button{margin-top:14px;height:34px;padding:0 16px;border:0;border-radius:var(--r-ctl);background:var(--brand-600);color:#fff;font:600 12.5px var(--font-sans);cursor:pointer}.cover-card button:disabled{opacity:.55;cursor:not-allowed}@media (prefers-reduced-motion:reduce){.hb-dot{animation:none}}`

export const MOD_WINDOW_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeftMate Mod</title><link rel="stylesheet" href="/weftmate/mods/window.css"></head><body><header class="host-bar" id="hostBar"><span class="hb-dot"></span><span><b id="name">Mod</b> · <span id="state">正在连接</span></span><span class="hb-tag">WeftMate Mod · 数据保存在本机</span><a id="back" href="#/mods">← 回到工作台</a></header><main class="mod-stage"><iframe id="modFrame" title="Mod 业务界面" sandbox="allow-scripts"></iframe><section class="cover" id="cover" aria-live="polite"><div class="cover-card"><h1 id="coverTitle">正在连接</h1><p id="coverText">正在读取 Mod 状态。</p><button id="start" type="button" hidden>启动</button></div></section></main><script type="module" src="/weftmate/mods/window.js"></script></body></html>`

export const MOD_WINDOW_JS = String.raw`import { createModFrameBridge } from '/weftmate/mods/bridge.mjs'
const api = window.weftmateModWindow
const element = id => document.getElementById(id)
const frame = element('modFrame'), bar = element('hostBar'), name = element('name'), state = element('state'), cover = element('cover'), coverTitle = element('coverTitle'), coverText = element('coverText'), start = element('start'), back = element('back')
let latest = null, bridge = null, loadedVersion = null, loadedToken = null, frameLoaded = false, starting = false
const blockedReasons = {NO_ACTIVE_VERSION:'尚无可用版本，请回到工作台查看。',PUBLISH_IN_PROGRESS:'正在更新，请稍后再启动。',ALREADY_RUNNING:'运行状态正在同步，请稍候。'}
function releaseBridge(){ if(bridge) bridge.dispose(); bridge=null }
function runBridge(){
  if(bridge || !frameLoaded || !latest?.connected || !latest?.controls?.canInvoke || !latest?.ui?.frameToken || !frame.contentWindow) return
  bridge=createModFrameBridge({frame,token:latest.ui.frameToken,onAction:value=>api.invoke({action:value.action,payload:value.payload})})
  bridge.requestHandshake()
}
function paint(snapshot){
  latest=snapshot
  const connected=snapshot?.connected===true, running=connected&&snapshot?.controls?.canInvoke===true, canStart=connected&&snapshot?.controls?.canStart===true
  document.body.classList.toggle('dark',snapshot?.theme==='dark')
  name.textContent=snapshot?.project?.name||'Mod'
  state.textContent=connected?(snapshot?.state?.label||'状态未知'):'已断连'
  bar.dataset.tone=connected?(snapshot?.state?.tone||'neutral'):'neutral'
  bar.classList.toggle('disconnected',!connected);bar.classList.toggle('stopped',connected&&snapshot?.state?.id==='stopped')
  cover.classList.toggle('show',!running)
  frame.inert=!running; frame.tabIndex=running?0:-1; frame.style.pointerEvents=running?'auto':'none'
  if(!running&&document.activeElement===frame) back.focus()
  start.hidden=!connected;start.disabled=!canStart||starting
  if(running){coverTitle.textContent='';coverText.textContent=''}
  else if(!connected){coverTitle.textContent='已断连';coverText.textContent='与 WeftMate 的连接已断开'}
  else {coverTitle.textContent=snapshot?.state?.label||'当前不可用';coverText.textContent=canStart?'此 Mod 已停止。启动后可继续使用业务界面。':(blockedReasons[snapshot?.controls?.startBlockedReason]||'此 Mod 目前不能提供业务操作。')}
  if(!running){releaseBridge();return}
  if(snapshot?.project?.activeVersionId!==loadedVersion || snapshot?.ui?.frameToken!==loadedToken){
    loadedVersion=snapshot.project.activeVersionId;loadedToken=snapshot.ui.frameToken;frameLoaded=false;releaseBridge();frame.src=snapshot.ui.assetUrl
  }else runBridge()
}
frame.addEventListener('load',()=>{frameLoaded=true;runBridge()})
window.addEventListener('message',event=>bridge?.receiveWindowMessage(event))
back.addEventListener('click',event=>{event.preventDefault();if(api) api.returnWorkspace().catch(()=>{coverText.textContent='暂时无法返回，请打开 WeftMate 主窗口。'})})
start.addEventListener('click',async()=>{
  if(starting||!latest?.controls?.canStart)return
  starting=true;start.disabled=true
  try{await api.control('start')}catch{coverText.textContent='启动失败，请回到工作台查看原因。'}
  finally{starting=false;start.disabled=!latest?.connected||!latest?.controls?.canStart}
})
if(api){const off=api.onStatus(paint);window.addEventListener('pagehide',()=>{releaseBridge();off()},{once:true});api.snapshot().then(paint,()=>paint({connected:false}))}
else paint({connected:false})`
