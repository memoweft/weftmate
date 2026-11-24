import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  validateWaveBuffer,
  createNativeSpeech,
  mountNativeSpeech,
} from '../src/runtime/dsh-adapter/speech.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';

function makeCanonicalWav(seconds = 0.25, sampleRate = 16000, channels = 1) {
  const samples = Math.floor(seconds * sampleRate) * channels;
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

test('validateWaveBuffer accepts canonical 16kHz mono PCM16 WAV and rejects malformed inputs', () => {
  const valid = makeCanonicalWav(0.5);
  assert.equal(validateWaveBuffer(valid, 120), 0.5);
  assert.throws(() => validateWaveBuffer(makeCanonicalWav(0.5, 48000, 1), 120), { code: 'INVALID_AUDIO' });
  assert.throws(() => validateWaveBuffer(makeCanonicalWav(0.5, 16000, 2), 120), { code: 'INVALID_AUDIO' });
  assert.throws(() => validateWaveBuffer(valid.subarray(0, 40), 120), { code: 'INVALID_AUDIO' });
  assert.throws(() => validateWaveBuffer(makeCanonicalWav(2, 16000, 1), 1), { code: 'INVALID_AUDIO' });
});

test('mountNativeSpeech activates pinned DSH SenseVoice provider and createNativeSpeech exposes status/prepare/transcribe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-speech-mount-'));
  const { Context } = await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/cordis/lib/index.js');
  const sub = await import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js');
  const ctx = new Context();
  const subFiber = ctx.plugin(sub.default || sub);
  try {
    mountNativeSpeech(ctx, {
      dshHome: root,
      loadModules: () => Promise.all([
        import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-speech-to-text/lib/index.js'),
        import('../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/lib/index.js'),
      ]),
    });
    const nativeSpeech = createNativeSpeech({ getSpeech: () => ctx.get('speechToText') });
    const deadline = Date.now() + 5000;
    let st = nativeSpeech.status();
    while ((!st.available || st.phase === 'checking') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      st = nativeSpeech.status();
    }
    assert.equal(st.available, true);
    assert.equal(st.providerId, 'sensevoice-local');
    assert.equal(st.location, 'host-local');
    assert.ok(st.languages.includes('zh'));
    assert.equal(st.phase, 'unprepared');
  } finally {
    await subFiber.dispose();
    await ctx.fiber.dispose?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test('personal HTTP speech routes forward status, prepare, and transcribe with strict key validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-speech-http-'));
  const calls: any[] = [];
  const backend = {
    async getStatus() { return { runtime: 'ready', capabilities: { chat: { available: true } } }; },
    listModels() { return []; },
    async preflight() { return { ok: true }; },
    async createSession() { return { sessionId: 's1' }; },
    async sendMessage() { return {}; },
    async cancelSession() { return {}; },
    async readEvents() { return { events: [], nextSeq: 0 }; },
    async describeSession() { return null; },
    async speechStatus() {
      return { available: true, providerId: 'sensevoice-local', providerName: 'SenseVoiceSmall (INT8)', phase: 'ready', maxDurationSeconds: 120 };
    },
    async speechPrepare(body: any) {
      calls.push(['prepare', body]);
      return { available: true, providerId: 'sensevoice-local', phase: body.action === 'cancel' ? 'cancelled' : 'downloading' };
    },
    async speechTranscribe(body: any) {
      calls.push(['transcribe', body.language, body.audioBase64.length]);
      return { text: '测试离线语音识别', language: 'zh', durationSeconds: 0.25 };
    },
  };
  const service = await createPersonalAccessService({ root, port: 0, backend });
  try {
    const { origin } = await service.start();
    const grant = await service.issueSetupGrant();
    const setup = await fetch(`${origin}/personal/v1/auth/setup`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'SpeechUser', password: 'SpeechPassword123!', deviceName: 'win-test' }),
    });
    assert.equal(setup.status, 201);
    const { csrfToken } = await setup.json();
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const headers = { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': csrfToken };

    const stRes = await fetch(`${origin}/personal/v1/speech/status`, { headers });
    assert.equal(stRes.status, 200);
    assert.equal((await stRes.json()).phase, 'ready');

    const prepRes = await fetch(`${origin}/personal/v1/speech/prepare`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'prepare' }),
    });
    assert.equal(prepRes.status, 200);
    assert.equal((await prepRes.json()).phase, 'downloading');

    const badPrep = await fetch(`${origin}/personal/v1/speech/prepare`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'bogus' }),
    });
    assert.equal(badPrep.status, 400);

    const wavB64 = makeCanonicalWav(0.25).toString('base64');
    const trRes = await fetch(`${origin}/personal/v1/speech/transcribe`, {
      method: 'POST', headers, body: JSON.stringify({ audioBase64: wavB64, language: 'auto' }),
    });
    assert.equal(trRes.status, 200);
    assert.equal((await trRes.json()).text, '测试离线语音识别');
    assert.deepEqual(calls, [['prepare', { action: 'prepare' }], ['transcribe', 'auto', wavB64.length]]);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Plan Mode button toggles plan mode and restores prior approval mode; voice button prepares SenseVoice when unprepared', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="composer-host">
        <div class="approval-picker" id="approval-picker">
          <button type="button" id="approval-mode-trigger"><span id="approval-mode-label">全部允许</span></button>
          <div id="approval-mode-menu" hidden></div>
        </div>
        <button type="button" id="plan-mode-toggle" aria-pressed="false"><span id="plan-mode-label">计划</span></button>
        <textarea id="message-text"></textarea>
        <button type="button" id="voice-input" aria-pressed="false"></button>
        <p id="toast" hidden></p>
      </div>
    `);
    await page.evaluate(() => { (globalThis as any).WeftUiComponents = { factories: {} }; });
    for (const file of ['icons.js', 'components/approvals.js', 'components/shell.js']) {
      await page.addScriptTag({ path: new URL('../src/personal-access-ui/' + file, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    }
    const result = await page.evaluate(async () => {
      const g: any = globalThis;
      const savedModes: string[] = [];
      const toasts: string[] = [];
      const speechCalls: string[] = [];
      const core: any = {
        state: {
          newConversation: false,
          newConversationApprovalMode: 'allow-all',
          identityGeneration: 1,
          selectedSessionId: 's1',
          activeChatSource: 'desktop',
          selectedPhoneConversationId: null,
        },
        currentApprovalMode: 'allow-all',
        approvalModes: [
          ['auto', '自动', '自动处理'],
          ['plan', '先出计划', '先给方案'],
          ['allow-all', '全部允许', '直接执行'],
        ],
        async saveApprovalMode(mode: string) {
          savedModes.push(mode);
          core.currentApprovalMode = mode;
          ui.renderApprovalMode();
        },
        async accessApi(path: string, opts?: any) {
          speechCalls.push(`${opts?.method || 'GET'} ${path}`);
          if (path === '/speech/status') return { available: true, providerId: 'sensevoice-local', phase: 'unprepared', maxDurationSeconds: 120 };
          if (path === '/speech/prepare') return { available: true, providerId: 'sensevoice-local', phase: opts?.body?.action === 'cancel' ? 'cancelled' : 'downloading', progress: { percent: 15 } };
          return {};
        },
      };
      const ui: any = {
        byId: (id: string) => document.getElementById(id),
        element: (tag: string, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; },
        toast: (msg: string) => toasts.push(msg),
        updateAvailability() {},
        voiceInput: null,
      };
      Object.assign(ui, g.WeftUiComponents.factories.approvals(core, ui), g.WeftUiComponents.factories.shell(core, ui));
      ui.mountApprovals();
      ui.renderApprovalMode();

      const planBtn = document.getElementById('plan-mode-toggle') as HTMLButtonElement;
      planBtn.click();
      const afterOn = { pressed: planBtn.getAttribute('aria-pressed'), active: planBtn.classList.contains('is-active'), mode: core.currentApprovalMode };
      planBtn.click();
      const afterOff = { pressed: planBtn.getAttribute('aria-pressed'), active: planBtn.classList.contains('is-active'), mode: core.currentApprovalMode };

      // Trigger local SenseVoice preparation on first mic click, then cancel on second click
      await ui.startVoiceInput();
      const voiceBtn = document.getElementById('voice-input') as HTMLButtonElement;
      const preparing = voiceBtn.classList.contains('is-preparing');
      await ui.startVoiceInput();
      const afterCancel = voiceBtn.classList.contains('is-preparing');

      return { savedModes, afterOn, afterOff, preparing, afterCancel, speechCalls, toasts };
    });
    assert.deepEqual(result.savedModes, ['plan', 'allow-all']);
    assert.deepEqual(result.afterOn, { pressed: 'true', active: true, mode: 'plan' });
    assert.deepEqual(result.afterOff, { pressed: 'false', active: false, mode: 'allow-all' });
    assert.equal(result.preparing, true);
    assert.equal(result.afterCancel, false);
    assert.deepEqual(result.speechCalls, ['GET /speech/status', 'POST /speech/prepare', 'POST /speech/prepare']);
  } finally {
    await browser.close();
  }
});
