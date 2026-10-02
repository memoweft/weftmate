/** Managed loopback fixture for the personal App; never uses a real model or user profile. */
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { ensurePrivateDirectory, ensurePrivateFile } from '../../src/private-host-storage.mjs';
import { activateMobileUiRelease, publishMobileUi } from '../../src/personal-access/mobile-ui-release.mjs';

const repository = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const defaultProfile = 'D:\\AIProjects\\WeftMate\\Runtime\\UnifiedAssistant\\personal-app-fixture-20260927';
const marker = 'weftmate-personal-app-fixture-v1';
const args = new Map();
for (const arg of process.argv.slice(2)) {
  const split = arg.indexOf('=');
  if (split < 0 || args.has(arg.slice(0, split)) ||
      !['--profile', '--port'].includes(arg.slice(0, split))) throw new Error('invalid fixture argument');
  args.set(arg.slice(0, split), arg.slice(split + 1));
}
const profile = resolve(args.get('--profile') ?? defaultProfile);
const port = Number(args.get('--port') ?? '18187');
if (!isAbsolute(profile) || !basename(profile).startsWith('personal-app-fixture-') ||
    !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid isolated fixture profile or port');
const markerFile = join(profile, 'fixture.marker');
if (existsSync(profile) && !existsSync(markerFile)) throw new Error('unmarked profile refused');
await ensurePrivateDirectory(profile);
if (!existsSync(markerFile)) {
  const fd = openSync(markerFile, 'wx', 0o600);
  try { writeFileSync(fd, marker); } finally { closeSync(fd); }
}
await ensurePrivateFile(markerFile);
if (readFileSync(markerFile, 'utf8') !== marker) throw new Error('fixture profile marker mismatch');

const uiSource = join(repository, 'apps', 'mobile-ui', 'www');
const sourceA = join(profile, 'ui-source-a');
const sourceB = join(profile, 'ui-source-b');
const releaseDir = join(profile, 'mobile-ui-releases');
if (!existsSync(sourceA)) cpSync(uiSource, sourceA, { recursive: true, errorOnExist: true });
const releaseAFile = join(profile, 'release-a.id');
if (!existsSync(releaseAFile)) {
  const first = await publishMobileUi({ sourceDir: sourceA, outputDir: releaseDir,
    uiVersion: '0.2.0-testA', releaseNotes: 'Isolated fixture A' });
  writeFileSync(releaseAFile, `0.2.0-testA-${first.assetBase.split('/')[5]}`, { flag: 'wx' });
}
const markdown = '测试模型回复。\n\n| 项目 | 状态 |\n| --- | --- |\n| 来源 | 合成测试模型 |\n\n```kotlin\nprintln("WeftMate fixture")\n```';
let modelRequests = 0, abortedRequests = 0;
function completion({ body, signal }) {
  modelRequests++;
  if (body.model !== 'synthetic-personal-model') throw Object.assign(new Error('wrong fixture model'), { code: 'MODEL_UNAVAILABLE' });
  if (body.stream !== true) return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: markdown } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const lastUserMessage = body.messages.filter((item) => item.role === 'user').at(-1);
  const hold = typeof lastUserMessage?.content === 'string' && lastUserMessage.content.includes('合成阻塞');
  const frames = [
    { choices: [{ index: 0, delta: { role: 'assistant' } }] },
    { choices: [{ index: 0, delta: { content: '测试模型回复。\n\n| 项目 | 状态 |\n| --- | --- |\n| 来源 | 合成测试模型 |' } }] },
    { choices: [{ index: 0, delta: { content: '\n\n```kotlin\nprintln("WeftMate fixture")\n```' } }] },
  ];
  let timer;
  let released = false;
  const stream = new ReadableStream({
    start(controller) {
      let index = 0;
      const tick = () => {
        if (signal.aborted) return;
        if (hold && index >= 2) return;
        if (index < frames.length) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frames[index++])}\n\n`));
          timer = setTimeout(tick, 100);
        } else {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          released = true;
          controller.close();
        }
      };
      timer = setTimeout(tick, 20);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        if (!released) { abortedRequests++; released = true; controller.error(new Error('fixture cancelled')); }
      }, { once: true });
    },
    cancel() { clearTimeout(timer); },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const unavailable = () => { const error = new Error('fixture has no DSH'); error.code = 'RUNTIME_UNAVAILABLE'; throw error; };
const backend = {
  getStatus: async () => ({ runtime: 'unavailable', referenceScan: 'pending',
    modules: { memory: 'disabled' }, capabilities: { chat: { available: false },
      desktopOpenApp: { available: false }, naturalLanguageDesktop: { available: false } } }),
  listModels: () => [{ id: 'synthetic-personal-profile', name: '测试模型 · 合成',
    model: 'synthetic-personal-model', configured: true, source: 'host', sourceKind: 'local' }],
  verifyModelProfile: async (id) => id === 'synthetic-personal-profile'
    ? { configured: true, reachable: true, modelListed: true, inferenceVerified: false } : unavailable(),
  modelCompletion: async ({ profileId, body, signal }) => profileId === 'synthetic-personal-profile'
    ? completion({ body, signal }) : unavailable(),
  preflight: unavailable, createSession: unavailable, sendMessage: unavailable,
  cancelSession: unavailable, readEvents: unavailable, describeSession: unavailable,
};
const service = await createPersonalAccessService({ root: join(profile, 'personal-access'), port, backend,
  uiHandler: servePersonalAccessUi, mobileUiDir: releaseDir,
  sharedProfileIsFormal: (marker) => marker.id === 'synthetic-personal-profile' });
await service.setSharedModelProfiles([{ id: 'synthetic-personal-profile', model: 'synthetic-personal-model',
  baseUrl: 'http://127.0.0.1:8081/v1', provider: 'openai-compatible', source: 'formal-host-catalog',
  credentialHash: createHash('sha256').update('synthetic-fixture-only').digest('hex') }]);
const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  input.close();
  await service.close();
  console.log('[personal-app-fixture] stopped');
}
input.on('line', async (line) => {
  const action = line.trim().toLowerCase();
  try {
    if (action === 'q') return void stop();
    if (action === 'ui b' || action === 'ui require3') {
      if (!existsSync(sourceB)) {
        cpSync(sourceA, sourceB, { recursive: true, errorOnExist: true });
        const html = join(sourceB, 'index.html');
        writeFileSync(html, readFileSync(html, 'utf8').replace('<div id="app">',
          '<div id="app"><p class="fixture-version-marker">合成界面 B</p>'));
        const css = join(sourceB, 'styles.css');
        writeFileSync(css, `${readFileSync(css, 'utf8')}\n.fixture-version-marker{position:fixed;top:2px;right:2px;z-index:999;background:#eaf0ff;color:#2859d8;font-size:10px}\n`);
      }
      const result = await publishMobileUi({ sourceDir: sourceB, outputDir: releaseDir,
        uiVersion: action === 'ui require3' ? '0.3.0-native3' : '0.2.1-testB',
        minNativeVersionCode: action === 'ui require3' ? 3 : 2,
        releaseNotes: action === 'ui require3' ? 'Requires native shell version 3' : 'Isolated fixture B' });
      console.log(`[personal-app-fixture] uiVersion=${result.uiVersion} minNativeVersionCode=${result.minNativeVersionCode} assetBase=${result.assetBase}`);
    } else if (action === 'ui a') {
      const result = await activateMobileUiRelease({ outputDir: releaseDir,
        releaseId: readFileSync(releaseAFile, 'utf8').trim() });
      console.log(`[personal-app-fixture] uiVersion=${result.uiVersion} assetBase=${result.assetBase}`);
    } else if (action === 'ui corrupt') {
      writeFileSync(join(releaseDir, 'current.json'), '{invalid fixture manifest');
      console.log('[personal-app-fixture] current manifest intentionally corrupted; ui a restores');
    } else if (action === 'status') {
      console.log(`[personal-app-fixture] modelRequests=${modelRequests} abortedRequests=${abortedRequests}`);
    } else console.log('[personal-app-fixture] commands: ui b | ui require3 | ui a | ui corrupt | status | q');
  } catch { console.log('[personal-app-fixture] command failed; no private data printed'); }
});
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  const { origin } = await service.start();
  console.log(`[personal-app-fixture] ready origin=${origin} profile=${profile}`);
  console.log('[personal-app-fixture] a fresh profile accepts synthetic registration; existing fixture accounts persist');
  console.log('[personal-app-fixture] synthetic model: profileId=synthetic-personal-profile model=synthetic-personal-model');
  console.log('[personal-app-fixture] commands: ui b | ui require3 | ui a | ui corrupt | status | q');
} catch (error) { await stop(); throw error; }
