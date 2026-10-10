// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
/** Native phone sizes/permission sheet and the actual Electron settings form. */
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { phone,shell,shot,pause,wait,pkg } from './s3a-android.mjs';
const out=resolve('tests/evidence/s3a');await mkdir(out,{recursive:true});
const f=await startTimelineCandidate({interactive:true,inlineProgress:true,s3a:true,historyCount:0,baseTime:Date.now()-10000});
const profile=await mkdtemp(join(tmpdir(),'weftmate-s3a-ui-'));let p,app;
const report={nativeAndroid:true,realElectron:true,syntheticAccounts:true,sizes:[],errors:[]};
try{
 shell('shell','pm','clear',pkg);shell('shell','wm','size','720x1560');shell('shell','wm','density','320');
 p=await phone(f.origin,f.credentials);p.page.on('pageerror',e=>report.errors.push(e.message));
 await p.page.evaluate(()=>page('notifications'));await p.page.getByText('已同步 · 通知规则立即生效',{exact:true}).waitFor();
 await f.recordActivity({key:'permission-needed',type:'memory.paused',title:'合成记忆状态',summary:'只用于权限验证'});
 await wait(()=>{try{shell('shell','uiautomator','dump','/sdcard/s3a-first-permission.xml');}catch{}try{return shell('shell','cat','/sdcard/s3a-first-permission.xml').includes('permission_deny_button');}catch{return false;}},'first real permission request');
 shot('permission-request-light');shell('shell','cmd','uimode','night','yes');await pause(500);shot('permission-request-dark');shell('shell','cmd','uimode','night','no');
 const xml=shell('shell','cat','/sdcard/s3a-first-permission.xml'),deny=xml.match(/<node[^>]*resource-id="com.android.permissioncontroller:id\/permission_deny_button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(deny);
 shell('shell','input','tap',String((Number(deny[1])+Number(deny[3]))/2),String((Number(deny[2])+Number(deny[4]))/2));
 await wait(async()=>!(await p.call('notifications.state')).systemAllowed,'permission denied');
 for(const [width,height]of [[360,780],[390,844]]){
   shell('shell','wm','size',`${width*2}x${height*2}`);await pause(500);
   const viewport=await p.page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));assert.equal(viewport.width,width);report.sizes.push({screen:{width,height},viewport});
   for(const theme of ['light','dark']){await p.call('settings.appearance',{value:theme});await p.page.evaluate(theme=>applyTheme(theme),theme);
     await p.page.getByRole('button',{name:'查看后台运行设置',exact:true}).scrollIntoViewIfNeeded();await pause(250);shot(`native-${width}-device-${theme}`);
     assert.equal(await p.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
     await p.page.getByRole('combobox',{name:'待审批',exact:true}).scrollIntoViewIfNeeded();await p.page.getByRole('combobox',{name:'待审批',exact:true}).click();shot(`native-${width}-mode-open-${theme}`);await p.page.keyboard.press('Escape');
   }
 }
 await p.close();p=null;
 const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
 env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
 const desktop=await app.firstWindow();desktop.on('pageerror',e=>report.errors.push(e.message));await localUiSession(desktop,f.credentials,'S3a layout synthetic',{mainChat:true});
 await desktop.getByRole('button',{name:'账户菜单',exact:true}).click();await desktop.getByRole('button',{name:'设置',exact:true}).click();await desktop.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'通知',exact:true}).click();
 await desktop.getByText('已同步 · 通知规则立即生效',{exact:true}).filter({visible:true}).waitFor();
 for(const width of [1000,480]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,780),width);
   for(const theme of ['light','dark']){await desktop.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;},theme);
     await desktop.getByRole('button',{name:'发送测试通知',exact:true}).scrollIntoViewIfNeeded();await desktop.screenshot({path:join(out,`electron-${width}-notifications-${theme}.png`)});
     assert.equal(await desktop.getByRole('dialog',{name:'设置',exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth),false);
   }
 }
 assert.deepEqual(report.errors,[]);await writeFile(join(out,'ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await p?.close().catch(()=>{});await app?.close();await f.close();await rm(profile,{recursive:true,force:true});shell('shell','wm','size','720x1280');shell('shell','wm','density','204');shell('shell','cmd','uimode','night','no');}
