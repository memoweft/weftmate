/** CDP attaches only to the explicitly allocated port of the QA app. */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const [port,theme]=process.argv.slice(2);
assert.match(port,/^\d+$/);assert.ok(['light','dark'].includes(theme));
const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const page=pages.find(p=>p.type==='page'&&p.url.includes('/personal/v1/ui'));
assert.ok(page,'the auto-opened real WeftMate renderer must be available');
const socket=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{socket.once('open',ok);socket.once('error',fail)});
let sequence=0;const pending=new Map();
socket.on('message',raw=>{const value=JSON.parse(raw);if(value.id){const task=pending.get(value.id);pending.delete(value.id);if(value.error)task?.reject(Error(value.error.message));else task?.resolve(value.result);}});
const send=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
try {
  const applied=await send('Runtime.evaluate',{expression:`(async()=>{const theme=${JSON.stringify(theme)};localStorage.setItem('weftmate.desktop.appearance.v1',JSON.stringify({theme,accent:'neutral',fontSize:'15'}));await window.weftmateDesktop.setTheme(theme);document.documentElement.dataset.theme=theme;return true})()`,awaitPromise:true,returnByValue:true});
  assert.equal(applied.exceptionDetails,undefined);
  const end=Date.now()+20000;
  while(Date.now()<end){
    await new Promise(r=>setTimeout(r,200));
    const r=await send('Runtime.evaluate',{expression:`document.readyState==='complete'&&document.documentElement.dataset.theme===${JSON.stringify(theme)}`,returnByValue:true});
    if(r.result?.value===true){await new Promise(r=>setTimeout(r,500));console.log(`Auto-opened real app theme: ${theme}`);socket.close();process.exit(0);}
  }
  throw Error('App did not apply the requested appearance preference');
} finally { socket.close(); }
