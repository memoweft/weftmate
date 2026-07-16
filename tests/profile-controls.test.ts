import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileOverrideStore } from '../src/profile-overrides.ts';
import { cognitionCorrectionOriginId } from '../src/cognition-correction.ts';
import { createProfileScheduler } from '../src/scheduler.ts';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('WeftMate 画像覆盖与指正幂等', () => {
  it('原子保存覆盖，UI 与 recall 只得到新文案，并可恢复原理解', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-overrides-')); roots.push(root);
    const file = join(root, 'profile-overrides.json');
    const store = new ProfileOverrideStore(file);
    const original = [{ id: 'c-1', content: '旧画像文本', invalidAt: null, archivedAt: null, mutedAt: null }];

    store.set('c-1', '用户确认的新画像', { ...original[0], contentType: 'preference', formedBy: 'stated' }, '2026-07-16T00:00:00.000Z');
    store.set('c-1', '用户确认的新画像最终版', undefined, '2026-07-16T00:01:00.000Z');

    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.overrides['c-1'].content, '用户确认的新画像最终版');
    assert.equal(readdirSync(root).some((name) => name.endsWith('.tmp')), false, '原子替换后不遗留半写文件');

    const ui = store.applyCognitions(original);
    assert.equal(ui[0].content, '用户确认的新画像最终版');
    assert.equal(ui[0].originalContent, '旧画像文本');
    assert.equal(ui[0].overridden, true);
    const recall = store.applyRecall(original, original);
    assert.equal(recall[0].content, '用户确认的新画像最终版');
    assert.doesNotMatch(JSON.stringify(recall), /旧画像文本/);
    assert.equal(original[0].content, '旧画像文本', 'MemoWeft 原对象不能被覆盖层改写');

    assert.equal(store.remove('c-1'), true);
    assert.equal(store.applyCognitions(original)[0].content, '旧画像文本');
  });

  it('覆盖后的新关键词可本地补召回，失效/静音项不会补入', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-effective-recall-')); roots.push(root);
    const store = new ProfileOverrideStore(join(root, 'profile-overrides.json'));
    const items = [
      { id: 'active', content: '旧爱好', contentType: 'preference', formedBy: 'inferred', invalidAt: null, archivedAt: null, mutedAt: null },
      { id: 'muted', content: '旧爱好二', contentType: 'preference', formedBy: 'inferred', invalidAt: null, archivedAt: null, mutedAt: 'now' },
    ];
    store.set('active', '每周学习陶艺', items[0]);
    store.set('muted', '每周学习陶艺但已暂停', items[1]);

    const matches = store.matchingOverrides(items, '你还记得我学陶艺吗', new Set(), 6);
    assert.deepEqual(matches.map((item) => item.id), ['active']);
    assert.equal(matches[0].content, '每周学习陶艺');
    assert.deepEqual(store.matchingOverrides(items, '学习陶艺', new Set(['active']), 6), []);
  });

  it('有覆盖时无 id 召回 fail-closed；底层消失后进入待核对，继续采用才重新进入 Agent', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-review-')); roots.push(root);
    const store = new ProfileOverrideStore(join(root, 'profile-overrides.json'));
    const source = { id: 'c-review', content: '旧的底层理解', contentType: 'goal', formedBy: 'inferred', invalidAt: null, archivedAt: null, mutedAt: null };
    assert.equal(store.applyRecall([{ content: '无覆盖时保持旧兼容行为', score: 1 }], [source]).length, 1);
    store.set(source.id, '我确认要长期学习陶艺', source);

    assert.deepEqual(store.applyRecall([{ content: '可能泄漏的旧文案', score: 1 }], [source]), []);
    const invalidView = store.applyCognitions([{ ...source, invalidAt: '2026-07-16T00:00:00Z', sources: [{ evidenceId: 'e-1' }] }])[0];
    assert.equal(invalidView.needsReview, true);
    assert.deepEqual(invalidView.sources, [{ evidenceId: 'e-1' }], '底层仍存在时保留溯源信息');
    const missingSources: typeof source[] = [];
    assert.equal(store.applyCognitions(missingSources)[0].needsReview, true);
    assert.deepEqual(store.matchingOverrides(missingSources, '学习陶艺', new Set(), 6), []);

    assert.ok(store.keepIndependent(source.id));
    const independent = store.applyCognitions(missingSources)[0];
    assert.equal(independent.independent, true);
    assert.equal(independent.needsReview, false);
    assert.equal(store.matchingOverrides(missingSources, '你还记得我学陶艺吗', new Set(), 6)[0].content, '我确认要长期学习陶艺');
    assert.ok(store.setIndependentMuted(source.id, true));
    assert.deepEqual(store.matchingOverrides(missingSources, '学习陶艺', new Set(), 6), []);
  });

  it('同一条同一内容的指正 originId 稳定，不同内容不会碰撞', () => {
    const first = cognitionCorrectionOriginId('c-9', '我更喜欢安静地工作');
    assert.equal(first, cognitionCorrectionOriginId('c-9', '  我更喜欢安静地工作  '));
    assert.notEqual(first, cognitionCorrectionOriginId('c-9', '我更喜欢一起讨论'));
    assert.doesNotMatch(first, /安静地工作/);
  });

  it('否定收据不复制正文，反悔后原子恢复为独立画像并重新进入召回', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-rejection-')); roots.push(root);
    const file = join(root, 'profile-overrides.json');
    const store = new ProfileOverrideStore(file);
    const source = {
      id: 'c-rejected', content: '用户适合团队协作', contentType: 'trait', formedBy: 'inferred',
      invalidAt: '2026-07-16T01:00:00.000Z', archivedAt: null, mutedAt: null,
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-16T01:00:00.000Z',
    };

    store.markRejected(source.id, '2026-07-16T01:00:00.000Z');
    const rejectedFile = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(rejectedFile.rejections[source.id], { rejectedAt: '2026-07-16T01:00:00.000Z' });
    assert.doesNotMatch(JSON.stringify(rejectedFile.rejections), /团队协作/);
    assert.equal(store.applyCognitions([source])[0].rejectedByUser, true);
    assert.deepEqual(store.applyRecall([{ id: source.id, content: source.content, score: 1 }], [source]), []);

    const restored = store.restoreRejected(source, '2026-07-16T02:00:00.000Z');
    assert.equal(restored?.independent, true);
    assert.equal(restored?.restoredFromRejection, true);
    const restoredFile = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(restoredFile.rejections[source.id], undefined);
    assert.equal(restoredFile.overrides[source.id].content, source.content);
    assert.equal(readdirSync(root).some((name) => name.endsWith('.tmp')), false, '恢复采用只留下完整原子文件');
    const view = store.applyCognitions([source])[0];
    assert.equal(view.invalidAt, null);
    assert.equal(view.restoredFromRejection, true);
    assert.equal(store.applyRecall([{ id: source.id, content: '旧召回', score: 1 }], [source])[0].content, source.content);

    store.set(source.id, '我更愿意在小团队协作', source, '2026-07-16T03:00:00.000Z');
    assert.equal(store.get(source.id)?.restoredFromRejection, undefined, '再次修改后成为普通用户确认画像');
  });

  it('底层条目真缺失时不能撤销否定，收据保持不动', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-rejection-missing-')); roots.push(root);
    const file = join(root, 'profile-overrides.json');
    const store = new ProfileOverrideStore(file);
    store.markRejected('missing', '2026-07-16T00:00:00.000Z');
    assert.equal(store.restoreRejected(null), null);
    assert.equal(store.hasRejection('missing'), true);
  });

  it('scheduler 冻结时保留 pending 但不启动整理，恢复后可继续', async () => {
    let updates = 0;
    const scheduler = createProfileScheduler({ updateProfile: async () => {
      updates++;
      return { consolidated: { created: [], reinforced: 0, corrected: 0, conflicted: 0 } };
    } });
    scheduler.freeze();
    scheduler.onTurn();
    assert.equal(scheduler.status().pendingSinceUpdate, 1);
    assert.equal((await scheduler.refreshNow()).ran, false);
    assert.equal(updates, 0);
    scheduler.resume();
    assert.equal((await scheduler.refreshNow()).ran, true);
    assert.equal(updates, 1);
    scheduler.dispose();
  });
});
