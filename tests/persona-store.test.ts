import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PersonaStore,
  PersonaStoreError,
  filterPersonaHistory,
  type PersonaManifest,
} from '../src/personas/store.ts';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

const builtins: PersonaManifest[] = [
  { schemaVersion: 1, id: 'plain', name: '普通助手', description: '中性助手', systemPrompt: '保持简洁。' },
  { schemaVersion: 1, id: 'xingyao', name: '星瑶', description: '温柔陪伴', systemPrompt: '你是星瑶。' },
  { schemaVersion: 1, id: 'aria', name: 'Aria', description: 'English companion', systemPrompt: 'You are Aria.' },
];

function setup(defaultId = 'xingyao') {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-personas-')); roots.push(root);
  const file = join(root, 'weftmate-personas.json');
  return { root, file, store: new PersonaStore(file, builtins, defaultId) };
}

describe('Persona Manifest / Store', () => {
  it('无文件沿用旧默认；切换先原子写盘，再被新实例恢复', () => {
    const { root, file, store } = setup('xingyao');
    assert.equal(store.current().id, 'xingyao');

    store.setCurrent('aria', '2026-07-16T07:00:00.000Z');
    assert.equal(store.current().id, 'aria');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).currentPersonaId, 'aria');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T07:00:00.000Z');
    assert.equal(readdirSync(root).some((name) => name.endsWith('.tmp')), false);

    const restarted = new PersonaStore(file, builtins, 'xingyao');
    assert.equal(restarted.current().id, 'aria');
    assert.equal(restarted.assistantHistoryBoundaryAt(), '2026-07-16T07:00:00.000Z');
  });

  it('自定义人格只把白名单 Manifest 写盘，内置人格只读且稳定', () => {
    const { file, store } = setup();
    const saved = store.save({
      name: '写作搭档', description: '帮我打磨文字', systemPrompt: '先理解意图，再给出清楚的改写。',
    }, '2026-07-16T08:00:00.000Z');
    assert.equal(saved.source, 'user');
    assert.equal(saved.editable, true);
    assert.equal(store.get('plain')?.editable, false);
    assert.throws(() => store.save({ id: 'plain', name: '改名', description: '', systemPrompt: 'x' }), /内置人格/);

    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(disk.personas[0].manifest).sort(), [
      'description', 'id', 'name', 'schemaVersion', 'systemPrompt',
    ]);
    assert.deepEqual(Object.keys(disk.personas[0]).sort(), ['createdAt', 'manifest', 'updatedAt']);
    assert.equal(JSON.stringify(disk.personas[0]).includes('memory'), false);
    assert.equal(JSON.stringify(disk).includes('apiKey'), false);
  });

  it('编辑保留 id/创建时间并立即更新当前解析；非法内容不改运行态或磁盘', () => {
    const { file, store } = setup();
    const created = store.save({ name: '研究助手', description: '查漏补缺', systemPrompt: '严谨回答。' }, '2026-07-16T08:00:00.000Z');
    store.setCurrent(created.id, '2026-07-16T08:30:00.000Z');
    const before = readFileSync(file, 'utf8');

    const edited = store.save({ id: created.id, name: '研究搭档', description: '先核实', systemPrompt: '不知道就直说。' }, '2026-07-16T09:00:00.000Z');
    assert.equal(edited.createdAt, '2026-07-16T08:00:00.000Z');
    assert.equal(edited.updatedAt, '2026-07-16T09:00:00.000Z');
    assert.equal(store.current().systemPrompt, '不知道就直说。');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T09:00:00.000Z', '编辑当前人格也要推进边界');

    const validDisk = readFileSync(file, 'utf8');
    assert.notEqual(validDisk, before);
    assert.throws(() => store.save({ id: created.id, name: '', description: '', systemPrompt: '' }), /名称/);
    assert.equal(store.current().systemPrompt, '不知道就直说。');
    assert.equal(readFileSync(file, 'utf8'), validDisk);
  });

  it('损坏文件启动回退 plain，第一次成功写前保留原始损坏副本', () => {
    const { root, file } = setup();
    writeFileSync(file, '{broken-json', 'utf8');
    const store = new PersonaStore(file, builtins, 'xingyao');
    assert.equal(store.current().id, 'plain');
    assert.deepEqual(readdirSync(root).filter((name) => name.includes('.corrupt-')), []);

    store.setCurrent('aria');
    const backups = readdirSync(root).filter((name) => name.includes('.corrupt-') && name.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(root, backups[0]), 'utf8'), '{broken-json');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).currentPersonaId, 'aria');
  });

  it('合法文件引用未知当前 ID 时回退 plain，不采用 Electron 旧默认', () => {
    const { file } = setup();
    writeFileSync(file, JSON.stringify({ version: 1, currentPersonaId: 'missing', assistantHistoryBoundaryAt: null, personas: [] }), 'utf8');
    const store = new PersonaStore(file, builtins, 'xingyao');
    assert.equal(store.current().id, 'plain');
  });

  it('兼容缺少新字段和 boundary 的旧 Store，首次写入补全字段且不丢旧自定义人格', () => {
    const { file } = setup();
    const legacyPersona = {
      source: 'user',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T01:00:00.000Z',
      manifest: { schemaVersion: 1, id: 'persona:legacy', name: '旧人格', description: '保留下来', systemPrompt: '旧提示词。' },
    };
    writeFileSync(file, JSON.stringify({ version: 1, currentPersonaId: 'persona:legacy', personas: [legacyPersona] }), 'utf8');

    const store = new PersonaStore(file, builtins, 'xingyao');
    assert.equal(store.current().name, '旧人格');
    assert.equal(store.assistantHistoryBoundaryAt(), null);
    store.setCurrent('aria', '2026-07-16T07:00:00.000Z');

    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk.builtinNameOverrides, {});
    assert.deepEqual(disk.hiddenBuiltinIds, []);
    assert.equal(disk.personas[0].manifest.id, 'persona:legacy');
    assert.equal('source' in disk.personas[0], false);
    assert.equal(new PersonaStore(file, builtins, 'xingyao').get('persona:legacy')?.name, '旧人格');
  });

  it('内置人格改名只持久化覆盖，重启后稳定 id 和源码提示词不变', () => {
    const { file, store } = setup('xingyao');
    const sourcePrompt = builtins.find((item) => item.id === 'xingyao')!.systemPrompt;
    const renamed = store.renamePersona('xingyao', '小星', '2026-07-16T08:00:00.000Z');
    assert.equal(renamed.id, 'xingyao');
    assert.equal(renamed.name, '小星');
    assert.match(renamed.systemPrompt, /当前名称是「小星」/);
    assert.equal(builtins.find((item) => item.id === 'xingyao')!.systemPrompt, sourcePrompt);
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T08:00:00.000Z');

    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk.builtinNameOverrides, { xingyao: '小星' });
    assert.equal(JSON.stringify(disk.builtinNameOverrides).includes(sourcePrompt), false);
    const restarted = new PersonaStore(file, builtins, 'plain');
    assert.equal(restarted.current().id, 'xingyao');
    assert.equal(restarted.current().name, '小星');
    assert.match(restarted.current().systemPrompt, /自称与称呼以这个用户设置的名称为准/);
  });

  it('plain 可改显示名但 Store 层拒绝删除，安全提示词保持代码来源', () => {
    const { store } = setup('plain');
    const sourcePrompt = builtins.find((item) => item.id === 'plain')!.systemPrompt;
    assert.equal(store.renamePersona('plain', '稳妥助手').name, '稳妥助手');
    assert.equal(store.current().id, 'plain');
    assert.match(store.current().systemPrompt, /当前名称是「稳妥助手」/);
    assert.equal(builtins.find((item) => item.id === 'plain')!.systemPrompt, sourcePrompt);
    assert.throws(
      () => store.removePersona('plain'),
      (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
    );
    assert.equal(store.current().id, 'plain');
    assert.equal(store.get('plain')?.canDelete, false);
    assert.equal(store.get('plain')?.safetyFallback, true);
  });

  it('删除非当前内置只写墓碑；删除当前内置原子回退 plain 并推进边界', () => {
    const { file, store } = setup('aria');
    store.removePersona('xingyao', '2026-07-16T08:00:00.000Z');
    assert.equal(store.current().id, 'aria');
    assert.equal(store.assistantHistoryBoundaryAt(), null);
    assert.equal(store.get('xingyao'), null);
    assert.equal(store.list().some((item) => item.id === 'xingyao'), false);
    let disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk.hiddenBuiltinIds, ['xingyao']);
    assert.equal(disk.currentPersonaId, 'aria');

    store.removePersona('aria', '2026-07-16T09:00:00.000Z');
    assert.equal(store.current().id, 'plain');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T09:00:00.000Z');
    disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(disk.currentPersonaId, 'plain');
    assert.equal(disk.assistantHistoryBoundaryAt, '2026-07-16T09:00:00.000Z');
    assert.deepEqual(disk.hiddenBuiltinIds.sort(), ['aria', 'xingyao']);
    const restarted = new PersonaStore(file, builtins, 'xingyao');
    assert.equal(restarted.current().id, 'plain');
    assert.equal(restarted.get('aria'), null);
  });

  it('自定义人格可硬删除；删除当前自定义原子回退 plain，删除非当前不改边界', () => {
    const { file, store } = setup('xingyao');
    const spare = store.save({ name: '临时一', description: '', systemPrompt: '一。' }, '2026-07-16T07:00:00.000Z');
    store.removePersona(spare.id, '2026-07-16T07:30:00.000Z');
    assert.equal(store.get(spare.id), null);
    assert.equal(store.current().id, 'xingyao');
    assert.equal(store.assistantHistoryBoundaryAt(), null);

    const active = store.save({ name: '临时二', description: '', systemPrompt: '二。' }, '2026-07-16T08:00:00.000Z');
    store.setCurrent(active.id, '2026-07-16T08:30:00.000Z');
    store.removePersona(active.id, '2026-07-16T09:00:00.000Z');
    assert.equal(store.get(active.id), null);
    assert.equal(store.current().id, 'plain');
    assert.equal(store.assistantHistoryBoundaryAt(), '2026-07-16T09:00:00.000Z');
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(disk.currentPersonaId, 'plain');
    assert.deepEqual(disk.personas, []);
  });

  it('纯函数在全会话保留所有用户话，只过滤边界前 assistant，边界后回复保留', () => {
    const turns = [
      { role: 'user' as const, content: '旧问题', ts: '2026-07-16T06:00:00.000Z' },
      { role: 'assistant' as const, content: '旧人格回答', ts: '2026-07-16T06:01:00.000Z' },
      { role: 'user' as const, content: '切换前用户补充', ts: '2026-07-16T06:02:00.000Z' },
      { role: 'assistant' as const, content: '新人格回答', ts: '2026-07-16T07:01:00.000Z' },
      { role: 'user' as const, content: '新问题', ts: '2026-07-16T07:02:00.000Z' },
    ];
    const filtered = filterPersonaHistory(turns, '2026-07-16T07:00:00.000Z');
    assert.deepEqual(filtered.map((turn) => turn.content), ['旧问题', '切换前用户补充', '新人格回答', '新问题']);
    assert.equal(filterPersonaHistory(turns, null).length, turns.length);
  });

  it('真实写盘失败抛 storage，磁盘和运行态都不变且不泄漏路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-personas-blocked-')); roots.push(root);
    const blockedParent = join(root, 'blocked');
    writeFileSync(blockedParent, 'sentinel', 'utf8');
    const file = join(blockedParent, 'weftmate-personas.json');
    const store = new PersonaStore(file, builtins, 'xingyao');
    const before = store.current().id;

    assert.throws(
      () => store.setCurrent('aria', '2026-07-16T10:00:00.000Z'),
      (error: unknown) => error instanceof PersonaStoreError
        && error.code === 'storage'
        && !error.message.includes(root),
    );
    assert.equal(store.current().id, before);
    assert.equal(store.assistantHistoryBoundaryAt(), null);
    assert.equal(readFileSync(blockedParent, 'utf8'), 'sentinel');
  });

  it('改名或删除写盘失败时，运行态和原磁盘都不变', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-personas-mutation-blocked-')); roots.push(root);
    const blockedParent = join(root, 'blocked');
    writeFileSync(blockedParent, 'sentinel', 'utf8');
    const store = new PersonaStore(join(blockedParent, 'weftmate-personas.json'), builtins, 'xingyao');

    assert.throws(() => store.renamePersona('xingyao', '写不进去'), (error: unknown) => error instanceof PersonaStoreError && error.code === 'storage');
    assert.equal(store.current().name, '星瑶');
    assert.throws(() => store.removePersona('xingyao'), (error: unknown) => error instanceof PersonaStoreError && error.code === 'storage');
    assert.equal(store.current().id, 'xingyao');
    assert.equal(store.get('xingyao')?.name, '星瑶');
    assert.equal(readFileSync(blockedParent, 'utf8'), 'sentinel');
  });

  it('提示词限制 8000 字、拒绝危险控制字符，自定义人格最多 100 个', () => {
    const { file, store } = setup();
    assert.throws(
      () => store.save({ name: '过长', description: '', systemPrompt: 'x'.repeat(8001) }),
      (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
    );
    assert.throws(
      () => store.save({ name: '危险\u0000名字', description: '', systemPrompt: '正常' }),
      (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
    );
    for (const name of ['两\n行', '回\r车', '带\t制表符', '\n前置换行']) {
      assert.throws(
        () => store.save({ name, description: '', systemPrompt: '正常' }),
        (error: unknown) => error instanceof PersonaStoreError
          && error.code === 'validation'
          && /只能写一行/.test(error.message),
      );
    }
    assert.throws(
      () => store.renamePersona('xingyao', '星\n瑶'),
      (error: unknown) => error instanceof PersonaStoreError
        && error.code === 'validation'
        && /只能写一行/.test(error.message),
    );
    assert.equal(store.get('xingyao')?.name, '星瑶');

    const personas = Array.from({ length: 100 }, (_, index) => ({
      createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z',
      manifest: { schemaVersion: 1, id: `persona:${index}`, name: `人格${index}`, description: '', systemPrompt: '正常提示' },
    }));
    writeFileSync(file, JSON.stringify({ version: 1, currentPersonaId: 'plain', assistantHistoryBoundaryAt: null, personas }), 'utf8');
    const full = new PersonaStore(file, builtins, 'xingyao');
    const diskBefore = readFileSync(file, 'utf8');
    assert.throws(
      () => full.save({ name: '第101个', description: '', systemPrompt: '正常' }),
      (error: unknown) => error instanceof PersonaStoreError && error.code === 'validation',
    );
    assert.equal(readFileSync(file, 'utf8'), diskBefore);
  });
});
