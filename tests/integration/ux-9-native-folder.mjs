// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {startFixture} from './ux-4-fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
process.env.TEMP=process.env.TMP='C:/Temp';
const root=mkdtempSync('C:/Temp/weftmate-ux9-native-'),folder=join(root,'SyntheticSelection');mkdirSync(folder);
const fixture=await startFixture(),repository=resolve('.'),out=join(repository,'tests/evidence/ux-9');let app;
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:repository,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:join(root,'profile'),REVIEW_ORIGIN:fixture.origin,REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken,REVIEW_THEME:'light'}});
 const page=await app.firstWindow();await localUiSession(page,fixture.credentials,'UX-9 native selection',{mainChat:true});await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).waitFor();await page.locator('#new-session').click();await page.getByRole('button',{name:'选择文件夹',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setTitle('UX-9 原生文件夹冒烟'));
 console.log('REAL_DIALOG_PATH',folder);await page.getByRole('button',{name:'添加文件夹',exact:true}).click();
 await page.getByRole('region',{name:'在文件夹里工作',exact:true}).waitFor({timeout:180000});
 assert.ok((await page.getByRole('region',{name:'在文件夹里工作'}).innerText()).toLowerCase().includes(folder.toLowerCase()));
 await page.screenshot({path:join(out,'native-dialog-selected.png')});await page.getByRole('button',{name:'取消',exact:true}).click();
 writeFileSync(join(out,'native-dialog.json'),JSON.stringify({realSystemDialog:true,syntheticFolder:true,cancelConfirmation:true},null,2));console.log('Real Windows folder dialog passed');
}finally{await app?.close();await fixture.close();rmSync(root,{recursive:true,force:true});}
