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
import { createMobileCloud } from './bl29-rework/auth.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { readMuMuInfo, adbExecutable } from '../../scripts/nightly/mumu.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.FIX40_EVIDENCE || 'D:/AIProjects/WeftMate/Runtime/Orchestrator/evidence/FIX-40');
const locks = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/locks';
mkdirSync(out, { recursive: true });
const android = process.argv.includes('--android'), pkg = 'com.memoweft.weftmate.mobile.fix40qa';
const theme = process.env.FIX40_THEME || 'light';
const recovery = process.env.FIX40_RECOVERY === '1';
let heavy, mumu, h, browser, serial, installed, proxy, cloud;
const reversed = [], proxyFrames = [];
const report = { realElectron: true, realDsh: true, theme, model: 'scripted HTTP provider', scenarios: [], relay: 'not exercised; local Linux relay prerequisite unavailable, see relay-environment.log' };
const outputs = new Map(), counts = new Map();
const execute = promisify(execFile);
async function lock(file, label) { const handle = await open(file, 'wx'); await handle.writeFile(`FIX-40 ${new Date().toISOString()} ${label}`); await handle.close(); return file; }
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
  if(android)cloud=await createMobileCloud();
  h = await migrationHost({cloudIdentity:cloud?.configuration});
  const files = join(h.root, 'FIX40-files');mkdirSync(files);
  h.respond = async body => {
    if (!body.tools?.length) return { role: 'assistant', content: '合成对话' };
    const tag = [...JSON.stringify(body.messages).matchAll(/FIX40_(ANDROID_ALLOW|ANDROID_REJECT|WEB_ALLOW|WEB_REJECT|DESKTOP_ALLOW|DESKTOP_REJECT)/g)].at(-1)?.[1];
    if (!tag && JSON.stringify(body.messages).includes('FIX40_SETUP_WORK')) {
      if (body.messages.some(row=>row.role==='tool'&&row.tool_call_id==='fix40-setup-read'))return {role:'assistant',content:'FIX40_SETUP_READY'};
      const loaded=body.tools.some(row=>row.function.name==='read');
      return {role:'assistant',tool_calls:[{id:loaded?'fix40-setup-read':'fix40-setup-load',type:'function',function:{name:loaded?'read':'load_tools',arguments:JSON.stringify(loaded?{file_path:join(files,'context.txt')}:{names:['read']})}}]};
    }
    if (!tag) return { role: 'assistant', content: '合成测试就绪。' };
    const n = counts.get(tag) || 0; counts.set(tag, n + 1);
    if (n >= 2) return { role: 'assistant', content: `FIX40_FINISHED_${tag}` };
    const file = join(files, `fix40-${tag.toLowerCase()}.txt`); outputs.set(tag, file);
    let name = n === 0 ? 'load_tools' : 'write', args = n === 0 ? { names: ['write'] } : { file_path: file, content: `FIX40_${tag}` };
    if (n === 1 && body.tools.some(row => row.function.name === 'run_code')) { name = 'run_code'; args = { code: `return await tools.write(${JSON.stringify(args)});`, description: '写入隔离测试文件' }; }
    if (!body.tools.some(row => row.function.name === name)) {
      report.providerUnavailable = {name,tools:body.tools.map(row=>row.function.name)};
      return {role:'assistant',content:'FIX40_PROVIDER_TOOL_UNAVAILABLE'};
    }
    return { role: 'assistant', tool_calls: [{ id: `fix40-${tag}-${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  // Exercise the actual persisted allow override that caused the pre-fix bypass.
  assert.equal((await h.api('/settings/approvals', { rules: { write: 'allow', command: 'allow' }, secondOpinionEnabled: false }, 'PATCH')).status, 200);
  const project = (await h.api('/projects', { requestId: 'fix40-files', name: 'FIX-40 合成文件夹', rootPath: files, permission: 'write' })).body.project;
  if (android) {
    // Prepare the normal main chat in work mode with a real read and its native
    // directory-choice receipt. No scenario output file exists during setup.
    writeFileSync(join(files,'context.txt'),'FIX40_SETUP_CONTEXT');
    const original=(await h.api('/chats/main')).body.chat;
    await h.api('/commands',{requestId:'fix40-work',kind:'chat.message',chatId:original.chatId,targetDeviceId:h.hostId,modelProfileId:h.modelId,text:'FIX40_SETUP_WORK'});
    const created=await until(async()=>{const row=(await h.api('/chats/main')).body.chat;return row.activeSessionId&&row;});
    const switchCard=await until(async()=>(await h.api(`/sessions/${created.activeSessionId}/approvals`)).body.approvals.find(row=>row.status==='pending'&&row.intent==='work-switch'));
    assert.equal((await h.api(`/sessions/${created.activeSessionId}/approvals/${switchCard.approvalId}`,{requestId:'fix40-prepare-directory',outcome:'allowed-once',workProjectId:project.projectId})).status,200);
    await until(()=>h.requests.some(row=>row.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('FIX40_SETUP_CONTEXT'))));
    await until(async()=>(await h.api('/chats/main')).body.chat.running===false);
    assert.ok(h.requests.some(row=>row.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('FIX40_SETUP_CONTEXT'))),'the setup really reads the isolated context file');
    const nativeChat=(await h.api('/chats/main')).body.chat;
    let phoneOrigin = h.origin, readFault = recovery, writeFault = recovery;
    {
      proxy = createServer(async (request, response) => {
        const path = request.url, method = request.method;
        let raw = ''; for await (const chunk of request) raw += chunk;
        const frame = {path,method,status:0};proxyFrames.push(frame);
        if (path.endsWith('/approval-mode') && (method === 'GET' && readFault || method === 'PATCH' && writeFault)) {
          if (method === 'GET') readFault=false;else writeFault=false;
          frame.status=503;response.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:{code:'NETWORK_UNAVAILABLE'}}));return;
        }
        try {
          const headers={...request.headers,host:new URL(h.origin).host,origin:h.origin};delete headers['content-length'];delete headers.connection;
          const upstream=await fetch(h.origin+path,{method,headers,...(raw?{body:raw}:{}),redirect:'manual'});
          const outgoing=Object.fromEntries(upstream.headers);delete outgoing['content-encoding'];delete outgoing['content-length'];delete outgoing['transfer-encoding'];
          frame.status=upstream.status;const bytes=Buffer.from(await upstream.arrayBuffer());
          if(upstream.status>=400)try{frame.errorCode=JSON.parse(bytes.toString()).error?.code;}catch{}
          response.writeHead(upstream.status,outgoing).end(bytes);
        } catch { frame.status=502;response.writeHead(502).end(); }
      });
      await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));phoneOrigin=`http://127.0.0.1:${proxy.address().port}`;
    }
    serial = readMuMuInfo().serial;
    execFileSync(adbExecutable, ['connect', serial], { windowsHide: true, timeout: 15000 });
    for(const port of new Set([new URL(h.origin).port,new URL(phoneOrigin).port,...(cloud?[new URL(cloud.configuration.issuer).port]:[])])) { adb('reverse', `tcp:${port}`, `tcp:${port}`); reversed.push(port); }
    for (const kind of ['debug/app-debug.apk', 'androidTest/debug/app-debug-androidTest.apk']) { adb('install', '-r', join(repo, 'apps/android/app/build/outputs/apk', kind)); installed = true; }
    adb('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');
    const credentials = h.credentials;
    // The scripted model is served by this Node process. Keep its event loop
    // available while the real Android instrumentation waits for model tools.
    const instrumented = await execute(adbExecutable, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'com.memoweft.weftmate.mobile.Fix40ApprovalInstrumentedTest',
      '-e', 'theme', theme, '-e', 'recovery', String(recovery), '-e', 'chatId', nativeChat.chatId, '-e', 'origin', phoneOrigin, '-e', 'username', credentials.username, '-e', 'password', credentials.password, `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`], { windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    const log = instrumented.stdout + instrumented.stderr;
    writeFileSync(join(out, 'android-instrumentation.log'), log.replaceAll(credentials.password, '<synthetic-password>'));
    const external = `/sdcard/Android/data/${pkg}/files`;
    for (const file of adb('shell', 'ls', external).split(/\s+/).filter(file => /^fix40-.*\.(png|json)$/.test(file)))
      writeFileSync(join(out, file), execFileSync(adbExecutable, ['-s', serial, 'exec-out', 'cat', `${external}/${file}`], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
    report.modelRequests = h.requests.filter(body => body.tools?.length).length;
    report.chat = (await h.api('/chats/' + nativeChat.chatId)).body.chat;
    report.preparedMainWorkConversation = true;
    assert.match(log, /OK \(1 test\)/);
    for (const tag of ['ANDROID_ALLOW', 'ANDROID_REJECT']) {
      const file = outputs.get(tag); assert.ok(file); assert.equal(existsSync(file), tag.endsWith('ALLOW'));
      if (tag.endsWith('ALLOW')) assert.equal(readFileSync(file, 'utf8'), 'FIX40_' + tag);
      report.scenarios.push({ tag, nativeUi: true, fileExists: existsSync(file) });
    }
    const rejectedInput = h.requests.findLast(body => JSON.stringify(body.messages).includes('FIX40_ANDROID_REJECT') && body.messages.some(m => m.role === 'tool'));
    assert.match(JSON.stringify(rejectedInput.messages), /rejected/i); report.modelReceivedRejection = true;
    if(recovery){
      assert.equal(readFault,false);assert.equal(writeFault,false);
      const saved=proxyFrames.findIndex(row=>row.method==='PATCH'&&row.path.endsWith('/approval-mode')&&row.status===200);
      const firstSend=proxyFrames.findIndex(row=>row.method==='POST'&&row.path==='/personal/v1/commands');
      assert.ok(saved>=0&&firstSend>saved,'a retried ask receipt must precede the first message');
      assert.equal(proxyFrames.some(row=>row.method==='PATCH'&&/^\/personal\/v1\/chats\/[^/]+$/.test(row.path)),false,'phone local approval choice never PATCHes a host chat');
      report.transientApprovalFailuresRecovered=true;report.proxyFrames=proxyFrames;
    }
  } else {
    browser = await chromium.launch({ channel: 'msedge' });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.goto(h.origin + '/personal/v1/ui'); await localUiSession(phone, h.credentials, 'FIX-40 mobile web', { mainChat: true });
    await phone.locator('#assistant-view').waitFor({ state: 'visible' });
    for (const [surface, page] of [['WEB', phone], ['DESKTOP', h.page]]) {
      await page.reload(); await page.locator('#assistant-view').waitFor({ state: 'visible' });
      await page.locator('#message-text').fill('FIX40_' + surface + '_ALLOW');
      await until(() => page.locator('#approval-mode-trigger').isEnabled());
      await page.locator('#approval-mode-trigger').click(); await page.locator('#approval-mode-menu [data-mode="ask"]').click();
      await until(() => page.locator('#approval-mode-label').textContent().then(value => value === '每次询问'));
      for (const outcome of ['ALLOW', 'REJECT']) {
        const tag = surface + '_' + outcome;
        await page.locator('#message-text').fill('FIX40_' + tag); await page.locator('#send-message').click();
        const active = await until(async () => (await h.api('/sessions')).body.sessions.find(row => row.running));
        const identity = (await h.api(`/sessions/${active.sessionId}/chat`)).body;
        const main = (await h.api('/chats/' + identity.chatId)).body.chat;
        let approval = await until(async () => (await h.api(`/sessions/${main.activeSessionId}/approvals`)).body.approvals.find(row => row.status === 'pending'));
        if (approval.intent === 'work-switch') {
          assert.equal(existsSync(outputs.get(tag)), false, 'work-directory choice cannot execute the write');
          const choice = page.getByRole('region', { name: '切换到工作', exact: true });
          await choice.getByRole('radio', { name: 'FIX-40 合成文件夹', exact: true }).click();
          await choice.getByRole('button', { name: '切换到工作', exact: true }).click();
          approval = await until(async () => (await h.api(`/sessions/${main.activeSessionId}/approvals`)).body.approvals.find(row => row.status === 'pending' && row.intent !== 'work-switch'));
          assert.equal((await h.api('/chats/' + main.chatId)).body.chat.approvalMode, 'ask');
        }
        assert.equal(existsSync(outputs.get(tag)), false);
        const card = page.locator(`[data-conversation-approval="${approval.approvalId}"]`);
        const action = card.getByRole('button', { name: outcome === 'ALLOW' ? '批准' : '拒绝', exact: true });
        await action.waitFor(); await action.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${outcome.toLowerCase()}-pending.png`) });
        await action.click();
        await page.getByText('FIX40_FINISHED_' + tag, { exact: true }).first().waitFor();
        await until(async () => (await h.api('/chats/' + main.chatId)).body.chat.running === false);
        await until(async () => (await page.locator('#send-message').getAttribute('data-action')) !== 'stop');
        assert.equal(existsSync(outputs.get(tag)), outcome === 'ALLOW');
        report.scenarios.push({ tag, fileExists: existsSync(outputs.get(tag)), approvalOutcome: outcome });
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${outcome.toLowerCase()}-finished.png`) });
      }
    }
  }
} catch (error) { report.error = error.message; await h?.page.screenshot({path:join(out,'acceptance-failed.png')}).catch(()=>{}); throw error; }
finally {
  if(proxyFrames.length)report.proxyFrames=proxyFrames;
  if(h)writeFileSync(join(out,'provider-diagnostics.json'),JSON.stringify(h.requests.filter(row=>row.tools?.length).map(row=>({tools:row.tools.map(tool=>tool.function.name),toolResults:row.messages.filter(message=>message.role==='tool')})),null,2));
  if (installed) { for (const name of [pkg + '.test', pkg]) try { adb('uninstall', name); } catch {} }
  for(const port of reversed) try { adb('reverse', '--remove', `tcp:${port}`); } catch {}
  if (serial) try { execFileSync(adbExecutable, ['disconnect', serial], { windowsHide: true, timeout: 10000 }); } catch {}
  try { await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));} await h?.close();await cloud?.close(); }
  finally {
    if (mumu) await unlink(mumu); if (heavy) await unlink(heavy);
    writeFileSync(join(out, android ? 'android-acceptance.json' : 'electron-web-acceptance.json'), JSON.stringify(report, null, 2));
    if (android) writeFileSync(join(out, `android-${theme}-acceptance.json`), JSON.stringify(report, null, 2));
  }
}
