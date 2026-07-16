import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PETS, DEFAULT_PET_ID, PET_SPRITE_V2_CONTRACT } from '../src/pets/schema.ts';
import { PetStore, PetStoreError } from '../src/pets/store.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-pets-'));
  roots.push(root);
  const file = join(root, 'weftmate-pets.json');
  return { root, file, store: new PetStore(file) };
}

const custom = {
  name: '小团', description: '一个沉稳的小伙伴。', shape: 'wisp',
  primary: '#334455', accent: '#aabbcc', feature: 'ears',
};

describe('Pet Store / Soul 绑定', () => {
  it('提供三个原创内置宠物和永久默认回退，不把内置复制进用户文件', () => {
    const { file, store } = setup();
    assert.equal(store.list().length, 3);
    assert.equal(store.fallback().id, DEFAULT_PET_ID);
    assert.equal(store.petForPersona('plain').id, DEFAULT_PET_ID);
    assert.equal(store.proactivityForPersona('plain'), 'light');
    assert.equal(BUILTIN_PETS.every((pet) => pet.appearance.kind === 'procedural'), true);
    assert.deepEqual(PET_SPRITE_V2_CONTRACT, {
      spriteVersionNumber: 2, atlasWidth: 1536, atlasHeight: 2288, columns: 8, rows: 11,
      cellWidth: 192, cellHeight: 208, standardAnimationRows: 9, lookDirections: 16,
    });
    store.setProactivity('plain', 'quiet');
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk.pets, []);
    assert.equal(JSON.stringify(disk).includes('systemPrompt'), false);
    assert.equal(JSON.stringify(disk).includes('memory'), false);
  });

  it('自定义宠物可创建编辑并在重启后恢复，Store 只落白名单字段', () => {
    const { file, store } = setup();
    const created = store.save(custom, '2026-07-16T12:00:00.000Z');
    assert.equal(created.source, 'user');
    assert.equal(created.appearance.primary, '#334455');
    const edited = store.save({ ...custom, id: created.id, name: '小团团', primary: '#445566' }, '2026-07-16T12:01:00.000Z');
    assert.equal(edited.name, '小团团');
    assert.equal(edited.createdAt, created.createdAt);
    const restarted = new PetStore(file);
    assert.equal(restarted.get(created.id)?.name, '小团团');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).pets[0].manifest).sort(), ['appearance', 'description', 'id', 'name', 'schemaVersion']);
  });

  it('Soul 可独立绑定宠物与主动度，同一宠物可复用，重启不丢', () => {
    const { file, store } = setup();
    const pet = store.save(custom);
    store.bind('xingyao', pet.id);
    store.bind('aria', pet.id);
    store.setProactivity('xingyao', 'companion');
    store.setProactivity('aria', 'quiet');
    assert.equal(store.bindingCount(pet.id), 2);
    assert.deepEqual(store.boundPersonaIds(pet.id).sort(), ['aria', 'xingyao']);
    assert.equal(store.petForPersona('xingyao').id, pet.id);
    assert.equal(store.proactivityForPersona('xingyao'), 'companion');
    assert.equal(store.proactivityForPersona('aria'), 'quiet');
    const restarted = new PetStore(file);
    assert.equal(restarted.petForPersona('aria').id, pet.id);
    assert.equal(restarted.proactivityForPersona('xingyao'), 'companion');
    restarted.removePersona('aria');
    assert.equal(restarted.petForPersona('aria').id, DEFAULT_PET_ID);
    assert.equal(restarted.proactivityForPersona('aria'), 'light');
    assert.equal(restarted.get(pet.id)?.id, pet.id);
  });

  it('删除自定义宠物与绑定同一次原子写，受影响 Soul 安全回退且主动度保留', () => {
    const { file, store } = setup();
    const pet = store.save(custom);
    store.bind('xingyao', pet.id);
    store.bind('aria', pet.id);
    store.setProactivity('xingyao', 'quiet');
    const removed = store.remove(pet.id);
    assert.deepEqual(removed.affectedPersonas.sort(), ['aria', 'xingyao']);
    assert.equal(store.get(pet.id), null);
    assert.equal(store.petForPersona('xingyao').id, DEFAULT_PET_ID);
    assert.equal(store.proactivityForPersona('xingyao'), 'quiet');
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(disk.petByPersona, {});
    assert.equal(disk.proactivityByPersona.xingyao, 'quiet');
  });

  it('拒绝额外字段、非法颜色/造型/主动度和删除内置宠物，不改变旧状态', () => {
    const { store } = setup();
    assert.throws(() => store.save({ ...custom, primary: 'red' }), (error: unknown) => error instanceof PetStoreError && error.code === 'validation');
    assert.throws(() => store.save({ ...custom, shape: 'cat' }), (error: unknown) => error instanceof PetStoreError && error.code === 'validation');
    assert.throws(() => store.setProactivity('plain', 'auto'), (error: unknown) => error instanceof PetStoreError && error.code === 'validation');
    assert.throws(() => store.remove(DEFAULT_PET_ID), (error: unknown) => error instanceof PetStoreError && error.code === 'validation');
    assert.equal(store.list().length, 3);
  });

  it('旧文件缺少绑定/主动度字段仍可读；未知宠物绑定安全回退', () => {
    const { file } = setup();
    writeFileSync(file, JSON.stringify({ version: 1, pets: [] }), 'utf8');
    const old = new PetStore(file);
    assert.equal(old.petForPersona('plain').id, DEFAULT_PET_ID);
    writeFileSync(file, JSON.stringify({ version: 1, pets: [], petByPersona: { plain: 'missing' }, proactivityByPersona: {} }), 'utf8');
    const dangling = new PetStore(file);
    assert.equal(dangling.petForPersona('plain').id, DEFAULT_PET_ID);
  });

  it('真实写盘失败时抛稳定错误，磁盘和运行态不变且不泄漏路径', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-pets-blocked-'));
    roots.push(root);
    const blockedParent = join(root, 'blocked');
    writeFileSync(blockedParent, 'sentinel', 'utf8');
    const store = new PetStore(join(blockedParent, 'weftmate-pets.json'));
    assert.throws(
      () => store.save(custom),
      (error: unknown) => error instanceof PetStoreError && error.code === 'storage' && !error.message.includes(root),
    );
    assert.equal(store.list().length, 3);
    assert.equal(readFileSync(blockedParent, 'utf8'), 'sentinel');
  });
});
