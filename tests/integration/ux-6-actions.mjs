import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/ux-6'),env={...process.env},checks=[],errors=[];for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let f,app,profile;
try{
  f=await startTimelineCandidate({daily:true,sidebar:true,goals:true,interactive:true,historyCount:0});const folder=join(f.root,'synthetic-project');await mkdir(folder);await f.request('/projects',{requestId:randomUUID(),name:'合成研究项目',rootPath:folder});
  profile=await mkdtemp(join(tmpdir(),'weftmate-ux6-actions-'));app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:f.origin,REVIEW_THEME:'light'}});
  const p=await app.firstWindow();p.setDefaultTimeout(15000);p.on('pageerror',error=>errors.push(error.message));await localUiSession(p,f.credentials,undefined,{mainChat:true});await p.getByRole('button',{name:'搜索',exact:true}).waitFor();await p.waitForTimeout(500);
  const ready=()=>p.waitForFunction(()=>document.querySelector('#search-results')?.getAttribute('aria-busy')==='false');
  async function open(){await p.keyboard.press('Control+k');await ready();}
  async function action(name){await open();await p.getByRole('option',{name,exact:true}).click();}
  for(const theme of ['light','dark']){
    await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await action('打开设置');await p.getByRole('dialog',{name:'设置',exact:true}).waitFor();await p.getByRole('button',{name:'关闭设置',exact:true}).click();checks.push(`${theme}:settings`);
    await action('新建项目');const project=p.getByRole('dialog',{name:'新建项目',exact:true});await project.waitFor();await p.waitForTimeout(200);await p.screenshot({path:join(out,`electron-1200-${theme}-project-dialog-open.png`)});await project.getByRole('button',{name:'取消',exact:true}).click();checks.push(`${theme}:new-project`);
    for(const [name,title] of [['打开动态','动态'],['打开目标','目标'],['打开成果库','成果库']]){await action(name);await p.waitForFunction(title=>document.querySelector('#assistant-title').textContent===title,title);checks.push(`${theme}:${title}`);}
    await open();await p.getByRole('combobox',{name:'搜索内容'}).fill('研究');await ready();await p.getByRole('tab',{name:'项目',exact:true}).click();await ready();await p.getByRole('option').filter({hasText:'合成研究项目'}).click();await p.locator('.sidebar-project-toggle:focus').waitFor();checks.push(`${theme}:open-project`);
    await action('新建旁聊');await p.getByRole('dialog',{name:'搜索',exact:true}).waitFor({state:'hidden'});checks.push(`${theme}:new-side`);
    await action('新建临时对话');await p.getByRole('dialog',{name:'搜索',exact:true}).waitFor({state:'hidden'});await p.getByText('这次聊的内容不会形成记忆，也不会出现在其他对话。',{exact:true}).waitFor();checks.push(`${theme}:temporary`);
  }
  const phrase='没有命中的合成开场句';await open();await p.getByRole('combobox',{name:'搜索内容'}).fill(phrase);await ready();await p.getByRole('option',{name:'新建旁聊并用这句话开始',exact:true}).click();
  const deadline=Date.now()+15000;while(Date.now()<deadline&&!f.operations.some(row=>row.kind==='message'&&row.text===phrase))await p.waitForTimeout(50);assert.ok(f.operations.some(row=>row.kind==='message'&&row.text===phrase));checks.push('empty-result-creates-and-sends-first-message');
  assert.deepEqual(errors,[]);await writeFile(join(out,'actions.json'),JSON.stringify({checks,errors,synthetic:true,modelRequests:0},null,2));console.log(checks.join('\n'));
}finally{await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await f?.close();if(profile)await rm(profile,{recursive:true,force:true});if(f?.root)await rm(f.root,{recursive:true,force:true});}
