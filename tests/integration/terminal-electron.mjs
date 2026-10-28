import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'weftmate-ui05-electron-'));
const evidence = resolve(process.env.WEFTMATE_EVIDENCE_DIR || '.local/terminal-evidence'); await mkdir(evidence, { recursive: true });
const env = { ...process.env, WEFTMATE_TERMINAL_TEST_DATA: root }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['tests/integration/terminal-electron-main.mjs'], env, timeout: 30000 });
const deadline = setTimeout(() => void app.close(), 90000);
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!globalThis.WeftTerminalPanel);
  await page.evaluate(() => {
    document.body.replaceChildren(); document.body.style.cssText = 'margin:0;height:100vh;display:flex;';
    globalThis.terminalOpenedAt = performance.now();
    globalThis.panel = WeftTerminalPanel.create({ conversationId: 'terminal-chat', mode: 'chat', tabId: 'electron-tab' });
    panel.el.style.cssText = 'height:100%;width:700px;'; document.body.append(panel.el); panel.show();
  });
  await page.getByRole('status').filter({ hasText: /^已连接$/ }).waitFor({ timeout: 20000 });
  const openMs = await page.evaluate(() => performance.now() - terminalOpenedAt);
  assert.match(await page.locator('.xterm-rows').evaluate(el => getComputedStyle(el).fontFamily), /Consolas/);
  const input = page.locator('.terminal-session:not([hidden]) textarea');
  async function command(text) { await input.focus(); await input.pressSequentially(text, { delay: 1 }); await input.press('Enter'); }
  await command("Write-Output ('面板' + '中文正常'); cd $env:TEMP; (Get-Location).Path; dir | Select-Object -First 1");
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('面板中文正常'));
  await command('node -i');
  await page.waitForFunction(() => document.querySelector('.xterm-rows').textContent.includes('Welcome to Node.js'));
  await command("'REPL' + (20 + 22)");
  await page.waitForFunction(() => document.querySelector('.xterm-rows').textContent.includes('REPL42'));
  await command('.exit');
  const before = await page.locator('.xterm-screen').evaluate(el => el.clientWidth);
  await page.evaluate(() => panel.el.style.width = '1000px');
  await page.waitForFunction(width => document.querySelector('.xterm-screen').clientWidth > width, before);
  await command("$ui05Value = 731; Start-Sleep -Milliseconds 400; Write-Output ('隐藏期间' + '继续运行')");
  await page.evaluate(() => panel.hide()); await page.waitForTimeout(600); await page.evaluate(() => panel.show());
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('隐藏期间继续运行'));
  await command('Write-Output ($ui05Value + 1)');
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('732'));
  await page.evaluate(() => panel.update({ conversationId: 'terminal-work', mode: 'work', tabId: 'electron-tab' }));
  await page.locator('.terminal-session:not([hidden])').getByRole('status').filter({ hasText: /^已连接$/ }).waitFor({ timeout: 20000 });
  await command("Write-Output ('工作目录' + (Get-Location).Path)");
  await page.waitForFunction(() => document.querySelector('.terminal-session:not([hidden]) .xterm-screen').textContent.includes('synthetic-project'));
  const settled = async marker => {
    await page.waitForFunction(marker => {
      const rows = [...document.querySelectorAll('.terminal-session:not([hidden]) .xterm-rows > div')].map(el => el.textContent.replaceAll('\u00a0',' ').trim()).filter(Boolean);
      return rows.join('').includes(marker) && rows.at(-1).endsWith('synthetic-project>');
    }, marker);
  };
  await settled('工作目录' + (await page.locator('.terminal-session:not([hidden]) .terminal-directory').innerText()).replace('起始目录：',''));
  const matrix = [];
  for (const [width, height] of [[1280,800], [900,700]]) for (const theme of ['light','dark']) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; panel.el.style.cssText = 'height:100%;width:100%;'; }, theme);
    await page.waitForTimeout(120);
    const marker = `尺寸验证完成${matrix.length}`;
    await command(`Clear-Host; Write-Output ('尺寸验证' + '完成${matrix.length}')`); await settled(marker);
    const name = `terminal-${width}x${height}-${theme}.png`; await page.screenshot({ path: join(evidence, name) });
    matrix.push({ window: {width,height}, theme, viewport: await page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})), name });
  }
  await page.setViewportSize({ width: 390, height: 780 }); await page.evaluate(() => panel.el.style.width = '100%');
  await page.waitForTimeout(160);
  await command("Clear-Host; Write-Output ('手机验证' + '完成')"); await settled('手机验证完成');
  await page.screenshot({ path: join(evidence, 'terminal-mobile-dark.png') });
  await page.evaluate(() => {
    const samples = { frames: [], longTasks: [], shifts: [] }; let running = true, last;
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
      if (entry.entryType === 'longtask') samples.longTasks.push(entry.duration);
      if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) samples.shifts.push(entry.value);
    } }); observer.observe({ entryTypes: ['longtask','layout-shift'] });
    const frame = now => { if (!running) return; if (last !== undefined) samples.frames.push(now-last); last=now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    globalThis.finishTerminalMetrics = () => { running=false; observer.disconnect(); const frames=[...samples.frames].sort((a,b)=>a-b);
      return { frameCount:frames.length, p50:frames[Math.floor(frames.length*.5)], p95:frames[Math.floor(frames.length*.95)],
        max:Math.max(...frames), over50ms:frames.filter(n=>n>50).length, longTasks:samples.longTasks,
        cls:samples.shifts.reduce((a,b)=>a+b,0), operations:['hide/show x10','conversation switch x10','resize x40'] }; };
  });
  await page.evaluate(async () => {
    const frames = async count => { for(let i=0;i<count;i++) await new Promise(requestAnimationFrame); };
    for(let i=0;i<10;i++) { panel.hide(); await frames(2); panel.show(); await frames(2); }
    for(let i=0;i<10;i++) { panel.update({conversationId:i%2?'terminal-work':'terminal-chat',mode:i%2?'work':'chat'}); await frames(3); }
    for(let i=0;i<40;i++) { panel.el.style.width=(240+i*3)+'px'; await frames(1); }
    await frames(8);
  });
  const smoothness = await page.evaluate(() => finishTerminalMetrics());
  assert.ok(smoothness.frameCount > 100 && smoothness.p95 < 50, 'offscreen render must not be background-throttled');
  await writeFile(join(evidence, 'weftmate-performance.json'), JSON.stringify({openMs, matrix, ...smoothness}, null, 2));
  await page.evaluate(() => panel.update({ conversationId: 'terminal-chat', mode: 'chat' }));
  await command('Write-Output ($ui05Value + 2)');
  await page.waitForFunction(() => document.querySelector('.terminal-session:not([hidden]) .xterm-screen').textContent.includes('733'));
  await command('exit');
  await page.getByRole('button', { name: '重新打开', exact: true }).click({ timeout: 12000 });
  await page.locator('.terminal-session:not([hidden])').getByRole('status').filter({ hasText: /^已连接$/ }).waitFor({ timeout: 20000 });
  await page.evaluate(() => panel.dispose());
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'electron-result.json'), JSON.stringify({ passed: true,
    checks: ['real authenticated Electron', 'Chinese input/output', 'cd and dir', 'interactive Node REPL', 'resize', 'hide keeps process variables', 'conversation directories', 'light/dark/mobile layout', 'exit and reopen', 'dispose'], errors }, null, 2));
  console.log('Terminal Electron acceptance passed');
} catch (error) {
  const page = (await app.windows())[0];
  console.error(await page?.evaluate(() => [...document.querySelectorAll('.xterm-rows')].map(el => el.textContent).join('\n').slice(-4000)).catch(() => null));
  throw error;
} finally { clearTimeout(deadline); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
