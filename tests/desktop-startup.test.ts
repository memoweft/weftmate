import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopStartup } from '../src/desktop-startup.mjs';
function fixture() {
  let loaded, quitting=false;
  const window=Object.assign(new EventEmitter(),{shown:0,hidden:0,destroyed:false,
    loadFile:()=>new Promise(resolve=>{loaded=resolve;}),
    show(){this.shown++;},hide(){this.hidden++;},isDestroyed(){return this.destroyed;},
    webContents:{executeJavaScript:async()=>{}},
  });
  return {window,load:()=>loaded(),quit:()=>{quitting=true;},options:{isQuitting:()=>quitting}};
}
test('closing the pending startup paint never resurfaces it after load or adoption',async()=>{
  const f=fixture(), startup=createDesktopStartup(f.window,f.options);let prevented=false;
  f.window.emit('close',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(f.window.hidden,1);
  f.load();await startup.ready;assert.equal(f.window.shown,0);
  startup.adopt();assert.equal(f.window.listenerCount('close'),0);
});
test('normal startup paints once, tray startup and quitting remain hidden',async()=>{
  for(const mode of ['normal','tray','quit']){
    const f=fixture(), startup=createDesktopStartup(f.window,{...f.options,startInTray:mode==='tray'});
    if(mode==='quit')f.quit();
    f.load();await startup.ready;assert.equal(f.window.shown,mode==='normal'?1:0);
    if(mode==='quit'){let prevented=false;f.window.emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,false);}
  }
});
test('startup load failure stays an error and does not claim a shown window',async()=>{
  const original=Error('synthetic load failure'),f=fixture();f.window.loadFile=()=>Promise.reject(original);
  const startup=createDesktopStartup(f.window,f.options);
  await assert.rejects(startup.ready,error=>error===original);
  await assert.rejects(startup.fail(),error=>error===original);
  assert.equal(f.window.shown,0);
});
test('normal startup restores saved maximization before showing the preparation shell',async()=>{
 const f=fixture(),order:string[]=[];f.window.maximize=()=>order.push('maximize');f.window.show=()=>order.push('show');
 const startup=createDesktopStartup(f.window,{...f.options,maximized:true});f.load();await startup.ready;
 assert.deepEqual(order,['maximize','show']);
});
