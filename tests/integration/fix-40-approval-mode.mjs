process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { migrationHost, until } from '../helpers/migration-host.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { readMuMuInfo, adbExecutable } from '../../scripts/nightly/mumu.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.env.FIX40_EVIDENCE || 'D:/AIProjects/WeftMate/Runtime/Orchestrator/evidence/FIX-40');
const locks = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/locks';
mkdirSync(out, { recursive: true });
const android = process.argv.includes('--android'), pkg = 'com.memoweft.weftmate.mobile.fix40qa';
const theme = process.env.FIX40_THEME || 'light';
let heavy, mumu, h, browser, serial, reversed, installed;
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
  h = await migrationHost();
  h.respond = async body => {
    if (!body.tools?.length) return { role: 'assistant', content: '合成对话' };
    const tag = [...JSON.stringify(body.messages).matchAll(/FIX40_(ANDROID_ALLOW|ANDROID_REJECT|WEB_ALLOW|WEB_REJECT|DESKTOP_ALLOW|DESKTOP_REJECT)/g)].at(-1)?.[1];
    if (!tag) return { role: 'assistant', content: '合成测试就绪。' };
    const n = counts.get(tag) || 0; counts.set(tag, n + 1);
    if (n >= 2) return { role: 'assistant', content: `FIX40_FINISHED_${tag}` };
    const file = join(h.root, `fix40-${tag.toLowerCase()}.txt`); outputs.set(tag, file);
    let name = n === 0 ? 'load_tools' : 'write', args = n === 0 ? { names: ['write'] } : { file_path: file, content: `FIX40_${tag}` };
    if (n === 1 && body.tools.some(row => row.function.name === 'run_code')) { name = 'run_code'; args = { code: `return await tools.write(${JSON.stringify(args)});`, description: '写入隔离测试文件' }; }
    assert.ok(body.tools.some(row => row.function.name === name), `scripted ${name} is available`);
    return { role: 'assistant', tool_calls: [{ id: `fix40-${tag}-${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  // Exercise the actual persisted allow override that caused the pre-fix bypass.
  assert.equal((await h.api('/settings/approvals', { rules: { write: 'allow', command: 'allow' }, secondOpinionEnabled: false }, 'PATCH')).status, 200);
  if (android) {
    serial = readMuMuInfo().serial;
    execFileSync(adbExecutable, ['connect', serial], { windowsHide: true, timeout: 15000 });
    const port = new URL(h.origin).port; adb('reverse', `tcp:${port}`, `tcp:${port}`); reversed = port;
    for (const kind of ['debug/app-debug.apk', 'androidTest/debug/app-debug-androidTest.apk']) { adb('install', '-r', join(repo, 'apps/android/app/build/outputs/apk', kind)); installed = true; }
    const credentials = h.credentials;
    // The scripted model is served by this Node process. Keep its event loop
    // available while the real Android instrumentation waits for model tools.
    const instrumented = await execute(adbExecutable, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', 'com.memoweft.weftmate.mobile.Fix40ApprovalInstrumentedTest',
      '-e', 'theme', theme, '-e', 'origin', h.origin, '-e', 'username', credentials.username, '-e', 'password', credentials.password, `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`], { windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    const log = instrumented.stdout + instrumented.stderr;
    writeFileSync(join(out, 'android-instrumentation.log'), log.replaceAll(credentials.password, '<synthetic-password>'));
    const external = `/sdcard/Android/data/${pkg}/files`;
    for (const file of adb('shell', 'ls', external).split(/\s+/).filter(file => /^fix40-.*\.(png|json)$/.test(file)))
      writeFileSync(join(out, file), execFileSync(adbExecutable, ['-s', serial, 'exec-out', 'cat', `${external}/${file}`], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
    report.modelRequests = h.requests.filter(body => body.tools?.length).length;
    report.mainChat = (await h.api('/chats/main')).body.chat;
    assert.match(log, /OK \(1 test\)/);
    for (const tag of ['ANDROID_ALLOW', 'ANDROID_REJECT']) {
      const file = outputs.get(tag); assert.ok(file); assert.equal(existsSync(file), tag.endsWith('ALLOW'));
      if (tag.endsWith('ALLOW')) assert.equal(readFileSync(file, 'utf8'), 'FIX40_' + tag);
      report.scenarios.push({ tag, nativeUi: true, fileExists: existsSync(file) });
    }
    const rejectedInput = h.requests.findLast(body => JSON.stringify(body.messages).includes('FIX40_ANDROID_REJECT') && body.messages.some(m => m.role === 'tool'));
    assert.match(JSON.stringify(rejectedInput.messages), /rejected/i); report.modelReceivedRejection = true;
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
        const main = await until(async () => { const chat = (await h.api('/chats/main')).body.chat; return chat.activeSessionId && chat; });
        const approval = await until(async () => (await h.api(`/sessions/${main.activeSessionId}/approvals`)).body.approvals.find(row => row.status === 'pending'));
        assert.equal(existsSync(outputs.get(tag)), false);
        const card = page.locator(`[data-conversation-approval="${approval.approvalId}"]`);
        const action = card.getByRole('button', { name: outcome === 'ALLOW' ? '批准' : '拒绝', exact: true });
        await action.waitFor(); await action.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${outcome.toLowerCase()}-pending.png`) });
        await action.click();
        await page.getByText('FIX40_FINISHED_' + tag, { exact: true }).first().waitFor();
        await until(async () => (await h.api('/chats/main')).body.chat.running === false);
        await until(async () => (await page.locator('#send-message').getAttribute('data-action')) !== 'stop');
        assert.equal(existsSync(outputs.get(tag)), outcome === 'ALLOW');
        report.scenarios.push({ tag, fileExists: existsSync(outputs.get(tag)), approvalOutcome: outcome });
        await page.screenshot({ path: join(out, `${surface.toLowerCase()}-${outcome.toLowerCase()}-finished.png`) });
      }
    }
  }
} catch (error) { report.error = error.message; await h?.page.screenshot({path:join(out,'acceptance-failed.png')}).catch(()=>{}); throw error; }
finally {
  if (installed) { for (const name of [pkg + '.test', pkg]) try { adb('uninstall', name); } catch {} }
  if (reversed) try { adb('reverse', '--remove', `tcp:${reversed}`); } catch {}
  if (serial) try { execFileSync(adbExecutable, ['disconnect', serial], { windowsHide: true, timeout: 10000 }); } catch {}
  try { await browser?.close(); await h?.close(); }
  finally {
    if (mumu) await unlink(mumu); if (heavy) await unlink(heavy);
    writeFileSync(join(out, android ? 'android-acceptance.json' : 'electron-web-acceptance.json'), JSON.stringify(report, null, 2));
    if (android) writeFileSync(join(out, `android-${theme}-acceptance.json`), JSON.stringify(report, null, 2));
  }
}
