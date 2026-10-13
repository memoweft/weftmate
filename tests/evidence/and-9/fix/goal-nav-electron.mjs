import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { managedMkdtempSync, disposeManagedTemp } from '../../../helpers/managed-temp.mjs';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';

process.env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
delete process.env.WEFTMATE_TEST_TEMP_SCOPE;
const repository=resolve(import.meta.dirname,'../../../..'), out=import.meta.dirname;
let slot, root, preparation, application, desktop;
const tempParent=`C:/weftmate-temp/weftmate-and9-goal-scope-${randomUUID()}`;process.env.WEFTMATE_MANAGED_TEMP_ROOT=tempParent;mkdirSync(tempParent,{recursive:true});
const report={realWeftMateElectron:true,syntheticAccount:true,paidModelRequests:0};
try {
    for(let i=1;i<=3&&!slot;i++)try {
        const path=`D:/AIProjects/WeftMate/Runtime/Orchestrator/heavy-${i}.lock`;
        const file=await open(path,'wx');await file.writeFile(`AND-9 ${new Date().toISOString()} goal navigation in real Electron`);await file.close();slot=path;
    }catch(error){if(error.code!=='EEXIST')throw error;}
    assert.ok(slot,'Wait for a heavy slot before starting Electron');
    report.startedAt=new Date().toISOString();
    root=managedMkdtempSync('weftmate-and9-goal-');const profile=join(root,'profile');mkdirSync(profile);
    writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
    const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>name==='listModels'?[]:{}]));
    preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
    const {origin}=await preparation.start(),setup=await preparation.issueSetupGrant(),password=`synthetic-${randomUUID()}-password`;
    const registered=await fetch(`${origin}/personal/v1/auth/setup`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:setup.grant,username:'GoalFixture',password,deviceName:'Synthetic preparation'})});
    assert.equal(registered.status,201);const cookie=registered.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');const me=await (await fetch(`${origin}/personal/v1/auth/me`,{headers:{cookie}})).json();const complete=await fetch(`${origin}/personal/v1/onboarding`,{method:'PATCH',headers:{origin,cookie,'x-weftmate-csrf':me.csrfToken,'content-type':'application/json'},body:JSON.stringify({step:'first',completed:true})});assert.equal(complete.status,200);await preparation.close();preparation=null;
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('WEFTMATE_')||key.startsWith('MEMOWEFT_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];env.WEFTMATE_TEST_HOST_NAME='synthetic-host';
    application=await _electron.launch({executablePath:'D:/AIProjects/WeftMate/Repository/node_modules/electron/dist/electron.exe',cwd:repository,args:['.',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
    desktop=await application.firstWindow();desktop.setDefaultTimeout(60000);await desktop.waitForURL('**/personal/v1/ui');
    console.log('Actual application ready; authenticate synthetic account through its account endpoint');
    const login=await desktop.evaluate(async credentials=>{const response=await fetch('/personal/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});return response.status},{username:'GoalFixture',password,deviceName:'Synthetic Electron'});assert.equal(login,200);await desktop.reload();await desktop.locator('#assistant-view').waitFor({state:'visible',timeout:15000});
    const drawing=await desktop.locator('.goals-entry svg').innerHTML();assert.match(drawing,/m9 12 2\.2 2\.2L15\.5 10/);report.desktopCheckedShield=true;
    await desktop.screenshot({path:join(out,'goal-desktop.png')});
    const newWindow=application.waitForEvent('window');
    await application.evaluate(async({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('/personal/v1/ui'));globalThis.and9RemoteWindow=new BrowserWindow({width:390,height:844,useContentSize:true,show:false,webPreferences:{session:main.webContents.session,sandbox:true,contextIsolation:true}});await globalThis.and9RemoteWindow.loadURL('about:blank')});
    const remote=await newWindow;remote.setDefaultTimeout(60000);const cdp=await remote.context().newCDPSession(remote);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const allowedOrigin=new URL(desktop.url()).origin;report.blockedExternalRequests=0;await remote.context().route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===allowedOrigin||['about:','data:'].includes(url.protocol))return route.continue();report.blockedExternalRequests++;return route.abort()});
    await remote.goto(desktop.url());await remote.locator('#remote-tab-goals').waitFor({state:'attached'});
    const remoteDrawing=await remote.locator('#remote-tab-goals svg').innerHTML();assert.match(remoteDrawing,/m9 12 2\.2 2\.2L15\.5 10/);report.remoteCheckedShield=true;
    report.remoteVerification='Actual mounted navigation DOM before cloud sign-in; no production account validation';
    report.passed=true;
} catch(error){if(desktop){try{await desktop.screenshot({path:join(out,'goal-diagnostic.png')});report.visibleText=(await desktop.locator('body').innerText()).slice(0,1600)}catch{}}report.failure=String(error.message).replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'C:/Users/<user>').replace(/DESKTOP-[A-Z0-9-]+/gi,'<host>');process.exitCode=1;}
finally {
    if(application)await application.close();if(preparation)await preparation.close();
    if(root)disposeManagedTemp(root,{log:()=>{}});try{rmdirSync(tempParent)}catch{};if(slot)await unlink(slot);
    report.releasedAt=new Date().toISOString();writeFileSync(join(out,'goal-electron-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
