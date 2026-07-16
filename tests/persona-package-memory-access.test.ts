import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PersonaStore,
  PersonaStoreError,
  type PersonaManifest,
} from '../src/personas/store.ts';
import { personaManifestShareBlockReason } from '../src/personas/manifest.ts';
import {
  __resetAgentTasksForTests,
  __setClientFactory,
  configureAgentDeps,
  getTaskView,
  startTask,
} from '../src/agent.ts';

const roots: string[] = [];
const builtins: PersonaManifest[] = [
  { schemaVersion: 1, id: 'plain', name: '普通助手', description: '中性助手', systemPrompt: '保持简洁。' },
  { schemaVersion: 1, id: 'xingyao', name: '星瑶', description: '温柔陪伴', systemPrompt: '你是星瑶。' },
  { schemaVersion: 1, id: 'aria', name: 'Aria', description: 'English companion', systemPrompt: 'You are Aria.' },
];

function setup(defaultId = 'xingyao') {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-persona-package-'));
  roots.push(root);
  const file = join(root, 'weftmate-personas.json');
  return { root, file, store: new PersonaStore(file, builtins, defaultId) };
}

async function waitTerminal(id: string) {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const view = getTaskView(id);
    if (view && ['done', 'failed', 'stopped'].includes(view.status)) return view;
    if (Date.now() > deadline) throw new Error(`等待任务结束超时：${JSON.stringify(view)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  __resetAgentTasksForTests();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Persona package 与每人格记忆读取权限', () => {
  it('导出严格五字段，不泄漏本地状态；改名内置的人格名称约束只出现一次且不改变 current', () => {
    const { store } = setup('xingyao');
    store.renamePersona('xingyao', '小星', '2026-07-16T08:00:00.000Z');
    const currentBefore = store.currentId();
    const manifest = store.exportManifest('xingyao');

    assert.deepEqual(Object.keys(manifest).sort(), ['description', 'id', 'name', 'schemaVersion', 'systemPrompt']);
    for (const privateKey of ['source', 'memoryReadEnabled', 'createdAt', 'updatedAt', 'current', 'assistantHistoryBoundaryAt']) {
      assert.equal(privateKey in manifest, false);
    }
    assert.equal(manifest.name, '小星');
    assert.equal((manifest.systemPrompt.match(/当前名称是「小星」/g) ?? []).length, 1);
    assert.equal(store.currentId(), currentBefore);
  });

  it('导出纯函数高置信阻断私钥、常见 token 和本机绝对路径', () => {
    const base: PersonaManifest = {
      schemaVersion: 1, id: 'safe', name: '安全人格', description: '', systemPrompt: '正常提示词',
    };
    const samples = [
      '-----BEGIN PRIVATE KEY-----\nsecret',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nsecret',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\nsecret',
      'sk-abcdefghijklmnopqrstuvwxyz123456',
      'github_pat_1234567890abcdefghijklmnopqrstuv',
      'AKIA1234567890ABCDEF',
      ['xoxb', '1234567890', 'abcdefghijklmnopqrstuv'].join('-'),
      'glpat-1234567890abcdefghijklmnop',
      'hf_1234567890abcdefghijklmnop',
      'sk_live_1234567890abcdefghijkl',
      'rk_live_1234567890abcdefghijkl',
      '请读取 C:\\Users\\someone\\secret.txt',
      '\\\\server\\share\\private.txt',
      '读取 /Users/someone/private.txt',
      '读取 /home/someone/private.txt',
      'path=/home/someone/private.txt',
      'path=C:\\Users\\someone\\private.txt',
      '/root/.ssh/id_rsa',
      '/Volumes/Private/file.txt',
      '/mnt/private/file.txt',
      '/var/private/file.txt',
      '/opt/private/file.txt',
      '/tmp/private/file.txt',
    ];
    for (const systemPrompt of samples) assert.ok(personaManifestShareBlockReason({ ...base, systemPrompt }), systemPrompt);
    assert.equal(personaManifestShareBlockReason(base), null);
  });

  it('导入总生成新 id，重名安全改名，默认不能读记忆且不切换 current', () => {
    const { file, store } = setup('plain');
    const pack: PersonaManifest = {
      schemaVersion: 1, id: 'publisher:writer', name: '星瑶', description: '写作', systemPrompt: '先理解再回答。',
    };
    const first = store.importManifest(pack, '2026-07-16T08:00:00.000Z');
    const second = store.importManifest(pack, '2026-07-16T09:00:00.000Z');

    assert.notEqual(first.id, pack.id);
    assert.notEqual(second.id, pack.id);
    assert.notEqual(first.id, second.id);
    assert.equal(first.name, '星瑶（导入）');
    assert.equal(second.name, '星瑶（导入 2）');
    assert.equal(first.memoryReadEnabled, false);
    assert.equal(second.memoryReadEnabled, false);
    assert.equal(store.currentId(), 'plain');
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(disk.memoryReadByPersona[first.id], false);
    assert.equal(disk.memoryReadByPersona[second.id], false);
    assert.equal(disk.currentPersonaId, 'plain');
  });

  it('严格拒绝额外字段/数组/错误版本/控制字符，失败前后没有半状态', () => {
    const { file, store } = setup('plain');
    store.setCurrent('plain', '2026-07-16T07:00:00.000Z');
    const diskBefore = readFileSync(file, 'utf8');
    const valid = { schemaVersion: 1, id: 'shared', name: '导入人格', description: '', systemPrompt: '正常。' };
    for (const candidate of [
      { ...valid, localState: true },
      [valid],
      { ...valid, schemaVersion: 2 },
      { ...valid, systemPrompt: '危险\u0000内容' },
    ]) {
      assert.throws(
        () => store.importManifest(candidate),
        (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
      );
      assert.equal(readFileSync(file, 'utf8'), diskBefore);
      assert.equal(store.list().filter((persona) => persona.source === 'user').length, 0);
    }
    for (const systemPrompt of [
      'token=glpat-1234567890abcdefghijklmnop',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\nsecret',
      '读取 /root/.ssh/id_rsa',
    ]) {
      assert.throws(
        () => store.importManifest({ ...valid, systemPrompt }),
        (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
      );
      assert.equal(readFileSync(file, 'utf8'), diskBefore);
      assert.equal(store.currentId(), 'plain');
      assert.equal(store.list().filter((persona) => persona.source === 'user').length, 0);
    }
  });

  it('旧 Store 缂字段默认允许；首次写补权限字段，开关持久且 current 双向推进边界、非 current 不推进', () => {
    const { file } = setup();
    writeFileSync(file, JSON.stringify({
      version: 1,
      currentPersonaId: 'xingyao',
      assistantHistoryBoundaryAt: null,
      personas: [],
      builtinNameOverrides: {},
      hiddenBuiltinIds: [],
    }), 'utf8');
    const store = new PersonaStore(file, builtins, 'plain');
    assert.equal(store.current().memoryReadEnabled, true);
    assert.equal(store.get('aria')?.memoryReadEnabled, true);

    store.setCurrent('xingyao', '2026-07-16T07:00:00.000Z');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).memoryReadByPersona, {});
    store.setMemoryRead('xingyao', false, '2026-07-16T08:00:00.000Z');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T08:00:00.000Z');
    store.setMemoryRead('xingyao', true, '2026-07-16T09:00:00.000Z');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T09:00:00.000Z');
    store.setMemoryRead('aria', false, '2026-07-16T10:00:00.000Z');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T09:00:00.000Z');
    assert.equal(new PersonaStore(file, builtins, 'plain').get('aria')?.memoryReadEnabled, false);
  });

  it('删除人格在同一快照清理权限，写失败不改变运行态', () => {
    const { file, store } = setup('plain');
    store.setMemoryRead('aria', false, '2026-07-16T08:00:00.000Z');
    store.removePersona('aria', '2026-07-16T09:00:00.000Z');
    assert.equal('aria' in JSON.parse(readFileSync(file, 'utf8')).memoryReadByPersona, false);

    const root = mkdtempSync(join(tmpdir(), 'weftmate-persona-package-blocked-'));
    roots.push(root);
    const blocked = join(root, 'blocked');
    writeFileSync(blocked, 'sentinel', 'utf8');
    const broken = new PersonaStore(join(blocked, 'personas.json'), builtins, 'plain');
    assert.throws(() => broken.setMemoryRead('plain', false), (error: unknown) => error instanceof PersonaStoreError && error.code === 'storage');
    assert.equal(broken.current().memoryReadEnabled, true);
    assert.equal(broken.assistantHistoryBoundaryAt(), null);
  });

  it('导入达到 100 个上限或真实写盘失败都不留下半个人格', () => {
    const { file } = setup('plain');
    const personas = Array.from({ length: 100 }, (_, index) => ({
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      manifest: {
        schemaVersion: 1, id: `persona:${index}`, name: `人格${index}`, description: '', systemPrompt: '正常提示。',
      },
    }));
    writeFileSync(file, JSON.stringify({
      version: 1, currentPersonaId: 'plain', assistantHistoryBoundaryAt: null, personas,
      builtinNameOverrides: {}, hiddenBuiltinIds: [], memoryReadByPersona: {},
    }), 'utf8');
    const full = new PersonaStore(file, builtins, 'plain');
    const before = readFileSync(file, 'utf8');
    const pack = { schemaVersion: 1, id: 'shared', name: '第101个', description: '', systemPrompt: '正常。' };
    assert.throws(() => full.importManifest(pack), (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation');
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(full.list().filter((persona) => persona.source === 'user').length, 100);

    const root = mkdtempSync(join(tmpdir(), 'weftmate-persona-import-blocked-'));
    roots.push(root);
    const blocked = join(root, 'blocked');
    writeFileSync(blocked, 'sentinel', 'utf8');
    const broken = new PersonaStore(join(blocked, 'personas.json'), builtins, 'plain');
    assert.throws(() => broken.importManifest(pack), (error: unknown) => error instanceof PersonaStoreError && error.code === 'storage');
    assert.equal(broken.list().filter((persona) => persona.source === 'user').length, 0);
    assert.equal(broken.currentId(), 'plain');
    assert.equal(readFileSync(blocked, 'utf8'), 'sentinel');
  });
});

describe('Agent 记忆读取硬边界', () => {
  it('converse / plan / drive 关闭时都不调用 recall，提示无召回内容但保留当前上下文与继续记录', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'weftmate-agent-memory-off-'));
    roots.push(ws);
    let recalls = 0;
    let recordChats = 0;
    let records = 0;
    const prompts: string[] = [];
    const contexts: string[] = [];
    configureAgentDeps({
      experience: () => ({ id: 'private', name: '私密人格', systemPrompt: '简洁回答。', memoryReadEnabled: false }),
      recall: async () => { recalls++; return '绝不能进入提示的旧召回'; },
      recordChat: async () => { recordChats++; },
      record: async () => { records++; },
    });

    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: unknown }>) {
        prompts.push(String(messages[0]?.content ?? ''));
        contexts.push(messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n'));
        return '自然回复';
      },
    }));
    const converse = startTask({
      task: '继续聊', workspace: ws, autonomy: 'auto', conversationOnly: true,
      context: [{ role: 'user', content: '当前对话里的名字是小林' }],
    });
    await waitTerminal(converse.id);

    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: unknown }>) {
        prompts.push(String(messages[0]?.content ?? ''));
        contexts.push(messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n'));
        return '{"summary":"建议","plan":[]}';
      },
    }));
    const plan = startTask({
      task: '给方案', workspace: ws, autonomy: 'suggest',
      context: [{ role: 'user', content: '当前对话里的目标是整理桌面' }],
    });
    await waitTerminal(plan.id);

    let driveCalls = 0;
    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: unknown }>) {
        if (driveCalls++ === 0) {
          prompts.push(String(messages[0]?.content ?? ''));
          contexts.push(messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n'));
          return '{"action":{"tool":"list_dir","args":{"path":"."}}}';
        }
        return '{"done":{"summary":"完成"}}';
      },
    }));
    const drive = startTask({
      task: '查看目录', workspace: ws, autonomy: 'auto',
      context: [{ role: 'user', content: '当前对话允许查看这里' }],
    });
    await waitTerminal(drive.id);

    assert.equal(recalls, 0);
    assert.equal(prompts.length, 3);
    for (const prompt of prompts) {
      assert.match(prompt, /不能读取长期记忆/);
      assert.match(prompt, /可以使用本轮提供的当前对话上下文/);
      assert.doesNotMatch(prompt, /关于用户你已知道|绝不能进入提示的旧召回/);
    }
    assert.match(contexts[0], /当前对话里的名字是小林/);
    assert.match(contexts[1], /当前对话里的目标是整理桌面/);
    assert.match(contexts[2], /当前对话允许查看这里/);
    assert.equal(recordChats, 2, '纯聊天和只建议仍记录用户新话');
    assert.equal(records, 1, '实际使用工具后仍记录任务结果');
  });

  it('允许读取时正常 recall 并把召回内容放进提示', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'weftmate-agent-memory-on-'));
    roots.push(ws);
    let recalls = 0;
    let prompt = '';
    configureAgentDeps({
      experience: () => ({ id: 'plain', name: '普通助手', systemPrompt: '正常回答。', memoryReadEnabled: true }),
      recall: async () => { recalls++; return '用户喜欢简洁回答'; },
    });
    __setClientFactory(() => ({
      async chat(messages: Array<{ role: string; content: unknown }>) {
        prompt = String(messages[0]?.content ?? '');
        return '好。';
      },
    }));
    const task = startTask({ task: '你好', workspace: ws, autonomy: 'auto', conversationOnly: true });
    await waitTerminal(task.id);
    assert.equal(recalls, 1);
    assert.match(prompt, /关于用户你已知道/);
    assert.match(prompt, /用户喜欢简洁回答/);
    assert.doesNotMatch(prompt, /不能读取长期记忆/);
  });
});
