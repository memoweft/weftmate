process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { migrationHost, until } from '../helpers/migration-host.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { readMuMuInfo, adbExecutable } from '../../scripts/nightly/mumu.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.FIX46_EVIDENCE || 'D:/AIProjects/WeftMate/Runtime/Orchestrator/evidence/FIX-46');
const locks = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/locks';
mkdirSync(out, { recursive: true });
const android = process.argv.includes('--android'), pkg = 'com.memoweft.weftmate.mobile.debug';
const theme = process.env.FIX46_THEME || 'light';
let heavy, mumu, h, browser, serial, proxy;
const reversed = [], proxyFrames=[];
const report = { realElectron: true, realDsh: true, theme, model: 'scripted HTTP provider', scenarios: [] };
const outputs = new Map(), counts = new Map();
const execute = promisify(execFile);
async function lock(file, label) { const handle = await open(file, 'wx'); await handle.writeFile(`FIX-46 ${new Date().toISOString()} ${label}`); await handle.close(); return file; }
const adb = (...args) => execFileSync(adbExecutable, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: args.includes('instrument') ? 240000 : 30000, maxBuffer: 8 * 1024 * 1024 });
try {
  while (true) {
    for (let i = 1; i <= 3 && !heavy; i++) try { heavy = await lock(join(locks, `heavy-${i}.lock`), 'Electron approval acceptance'); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const availableSlot = !!heavy;
    if (heavy && android) try { mumu = await lock(join(locks, 'mumu.lock'), 'native approve/reject acceptance'); }
    catch (error) { await unlink(heavy); heavy = null; if (error.code !== 'EEXIST') throw error; }
    if (heavy) break;
    process.stdout.write('Waiting for the shared acceptance slot; no lock held.\n');
    for (let i = 0; i < (availableSlot ? 1 : 4); i++) await new Promise(resolve => setTimeout(resolve, 30000));
  }
  
  h = await migrationHost();
  const files = join(h.root, 'FIX46-files');mkdirSync(files);
  h.respond = async body => {
    if (!body.tools?.length) return { role: 'assistant', content: '合成对话' };
    const tag = [...JSON.stringify(body.messages).matchAll(/FIX46_(ANDROID_ALLOW|ANDROID_REJECT|WEB_ALLOW|WEB_REJECT|DESKTOP_ALLOW|DESKTOP_REJECT)/g)].at(-1)?.[1];
    if (!tag && JSON.stringify(body.messages).includes('FIX46_SETUP_WORK')) {
      if (body.messages.some(row=>row.role==='tool'&&row.tool_call_id==='fix46-setup-read'))return {role:'assistant',content:'FIX46_SETUP_READY'};
      const loaded=body.tools.some(row=>row.function.name==='read');
      return {role:'assistant',tool_calls:[{id:loaded?'fix46-setup-read':'fix46-setup-load',type:'function',function:{name:loaded?'read':'load_tools',arguments:JSON.stringify(loaded?{file_path:join(files,'context.txt')}:{names:['read']})}}]};
    }
    if (!tag) return { role: 'assistant', content: '合成测试就绪。' };
    const n = counts.get(tag) || 0; counts.set(tag, n + 1);
    if (n >= 2) return { role: 'assistant', content: `FIX46_FINISHED_${tag}` };
    const file = join(files, `fix46-${tag.toLowerCase()}.txt`); outputs.set(tag, file);
    let name = n === 0 ? 'load_tools' : 'write', args = n === 0 ? { names: ['write'] } : { file_path: file, content: `FIX46_${tag}` };
    if (n === 1 && body.tools.some(row => row.function.name === 'run_code')) { name = 'run_code'; args = { code: `return await tools.write(${JSON.stringify(args)});`, description: '写入隔离测试文件' }; }
    if (!body.tools.some(row => row.function.name === name)) {
      report.providerUnavailable = {name,tools:body.tools.map(row=>row.function.name)};
      return {role:'assistant',content:'FIX46_PROVIDER_TOOL_UNAVAILABLE'};
    }
    return { role: 'assistant', tool_calls: [{ id: `fix46-${tag}-${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  // Exercise the actual persisted allow override that caused the pre-fix bypass.
  assert.equal((await h.api('/settings/approvals', { rules: { write: 'allow', command: 'allow' }, secondOpinionEnabled: false }, 'PATCH')).status, 200);
  const project = (await h.api('/projects', { requestId: 'fix46-files', name: 'FIX-46 合成文件夹', rootPath: files, permission: 'write' })).body.project;
  {
    browser = await chromium.launch({ channel: 'msedge' });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.goto(h.origin + '/personal/v1/ui'); await localUiSession(phone, h.credentials, 'FIX-46 mobile web', { mainChat: true });
    await phone.locator('#assistant-view').waitFor({ state: 'visible' });
    for (const [surface, page] of (android ? [['ANDROID',h.page]] : [['WEB', phone], ['DESKTOP', h.page]])) {
      await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
      await page.locator('#message-text').fill('FIX46_' + surface + '_ALLOW');
      await until(() => page.locator('#approval-mode-trigger').isEnabled());
      await page.locator('#approval-mode-trigger').click(); await page.locator('#approval-mode-menu [data-mode="ask"]').click();
      await until(() => page.locator('#approval-mode-label').textContent().then(value => value === '每次询问'));
      for (const outcome of (android ? ['REJECT'] : ['ALLOW', 'REJECT'])) {
        const tag = surface + '_' + outcome;
        await page.locator('#message-text').fill('FIX46_' + tag); await page.locator('#send-message').click();
        const active = await until(async () => (await h.api('/sessions')).body.sessions.find(row => row.running));
        const identity = (await h.api(`/sessions/${active.sessionId}/chat`)).body;
        const main = (await h.api('/chats/' + identity.chatId)).body.chat;
        let approval = await until(async () => (await h.api(`/sessions/${main.activeSessionId}/approvals`)).body.approvals.find(row => row.status === 'pending'));
        if (approval.intent === 'work-switch') {
          assert.equal(existsSync(outputs.get(tag)), false, 'work-directory choice cannot execute the write');
          const choice = page.getByRole('region', { name: '切换到工作', exact: true });
          await choice.getByRole('radio', { name: 'FIX-46 合成文件夹', exact: true }).click();
          await choice.getByRole('button', { name: '切换到工作', exact: true }).click();
          approval = await until(async () => (await h.api(`/sessions/${main.activeSessionId}/approvals`)).body.approvals.find(row => row.status === 'pending' && row.intent !== 'work-switch'));
          assert.equal((await h.api('/chats/' + main.chatId)).body.chat.approvalMode, 'ask');
        }
        assert.equal(existsSync(outputs.get(tag)), false);
        if(android) {
          proxy = createServer(async (req,res)=>{
            try {
              let raw='';for await(const chunk of req)raw+=chunk;
              const {method,params:p}=JSON.parse(raw);let value;
              if(method==='host.business') value=await h.api(p.path.replace('/personal/v1',''),p.body,p.method);
              else if(method==='shared.approvals.list')value=await h.api(`/sessions/${p.sessionId}/approvals`);
              else if(method==='shared.approvals.decide')value=await h.api(`/sessions/${p.sessionId}/approvals/${p.approvalId}`,Object.fromEntries(['requestId','outcome','scope','workProjectId'].filter(key=>p[key]!=null).map(key=>[key,p[key]])));
              else if(method==='shared.questions.list')value=await h.api(`/sessions/${p.sessionId}/questions`);
              else if(method==='shared.sessions.eventDetail')value=await h.api(`/sessions/${p.sessionId}/events/${p.seq}/detail`);
              else value={status:200,body:method==='attachments.list'?{attachments:[]}:method==='shared.outbox.list'?{commands:[]}: {}};
              proxyFrames.push({method,status:value.status,...(value.status>=400?{error:value.body.error}: {})});
              res.writeHead(value.status>=400?500:200,{'content-type':'application/json'}).end(JSON.stringify(value.body));
            } catch(error){res.writeHead(500).end(JSON.stringify({error:error.message}));}
          });
          await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
          serial=readMuMuInfo().serial;
          execFileSync(adbExecutable,['connect',serial],{windowsHide:true,timeout:15000});
          const port=String(proxy.address().port);adb('reverse',`tcp:${port}`,`tcp:${port}`);reversed.push(port);
          for(const kind of ['debug/app-debug.apk','androidTest/debug/app-debug-androidTest.apk'])adb('install','-r',join(repo,'apps/android/app/build/outputs/apk',kind));
          const instrumented=await execute(adbExecutable,['-s',serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.Fix46ApprovalCopyInstrumentedTest','-e','theme',theme,'-e','chatId',main.chatId,'-e','origin',`http://127.0.0.1:${port}`,`${pkg}.test/androidx.test.runner.AndroidJUnitRunner`],{windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
          writeFileSync(join(out,`android-${theme}-instrumentation.log`),instrumented.stdout+instrumented.stderr);
          assert.match(instrumented.stdout,/OK \(1 test\)/);
          for(const name of ['card','details','rejected'])writeFileSync(join(out,`android-${theme}-${name}.png`),execFileSync(adbExecutable,['-s',serial,'exec-out','cat',`/sdcard/Android/data/${pkg}/files/fix46-${theme}-${name}.png`],{windowsHide:true,maxBuffer:10*1024*1024}));
          assert.equal(existsSync(outputs.get(tag)),false);report.scenarios.push({tag,nativeUi:true,fileExists:false});
          continue;
        }
        const card = page.locator(`[data-conversation-approval="${approval.approvalId}"]`);
        const action = card.getByRole('button', { name: outcome === 'ALLOW' ? '批准' : '拒绝', exact: true });
        await action.waitFor(); await action.scrollIntoViewIfNeeded();
        const title = card.locator('summary').first();
        assert.doesNotMatch(await title.textContent(), /weftmate:|pwsh|file_path|[{}]/);
        await title.click();
        await until(()=>card.locator('pre').textContent().then(text=>text.includes('file_path')));
        await page.screenshot({path:join(out,`${surface.toLowerCase()}-${theme}-details.png`)});
        await title.click();
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${theme}-${outcome.toLowerCase()}-pending.png`) });
        await action.click();
        await page.getByText('FIX46_FINISHED_' + tag, { exact: true }).first().waitFor();
        await until(async () => (await h.api('/chats/' + main.chatId)).body.chat.running === false);
        await until(async () => (await page.locator('#send-message').getAttribute('data-action')) !== 'stop');
        assert.equal(existsSync(outputs.get(tag)), outcome === 'ALLOW');
        if(outcome==='REJECT') await page.getByText(/你拒绝了.*没有做/).first().waitFor();
        report.scenarios.push({ tag, fileExists: existsSync(outputs.get(tag)), approvalOutcome: outcome });
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${theme}-${outcome.toLowerCase()}-finished.png`) });
      }
    }
  }
} catch (error) { report.error = error.message; await h?.page.screenshot({path:join(out,'acceptance-failed.png')}).catch(()=>{}); throw error; }
finally {
  if(proxyFrames.length)writeFileSync(join(out,`android-${theme}-requests.json`),JSON.stringify(proxyFrames,null,2));
  if(h)writeFileSync(join(out,'provider-diagnostics.json'),JSON.stringify(h.requests.filter(row=>row.tools?.length).map(row=>({tools:row.tools.map(tool=>tool.function.name),toolResults:row.messages.filter(message=>message.role==='tool')})),null,2));
  for(const port of reversed) try { adb('reverse', '--remove', `tcp:${port}`); } catch {}
  if (serial) try { execFileSync(adbExecutable, ['disconnect', serial], { windowsHide: true, timeout: 10000 }); } catch {}
  try { await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));} await h?.close(); }
  finally {
    if (mumu) await unlink(mumu); if (heavy) await unlink(heavy);
    writeFileSync(join(out, android ? 'android-acceptance.json' : `electron-web-${theme}-acceptance.json`), JSON.stringify(report, null, 2));
    if (android) writeFileSync(join(out, `android-${theme}-acceptance.json`), JSON.stringify(report, null, 2));
  }
}
