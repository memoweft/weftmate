/**
 * WeftMate -> MemoWeft 真实消费方契约。
 *
 * 只经产品层 adapter 使用公开 API，防止类型可编译但发布包缺少关键词召回
 * 或导出版本仍停在旧版本。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoWeftCore, type MemoryBundle } from '../src/memoweft.ts';

const EMBED_ENV_KEYS = [
  'MEMOWEFT_EMBED_BASE_URL',
  'MEMOWEFT_EMBED_API_KEY',
  'MEMOWEFT_EMBED_MODEL',
  'DLA_EMBED_BASE_URL',
  'DLA_EMBED_API_KEY',
  'DLA_EMBED_MODEL',
] as const;

test('MemoWeft 0.5.1：导入记忆包后可用无 embedding 关键词召回，并导出正确版本', async () => {
  const savedEmbedEnv = new Map(EMBED_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of EMBED_ENV_KEYS) process.env[key] = '';

  const subjectId = 'weftmate-compat-user';
  const now = new Date().toISOString();
  const cognitionId = 'weftmate-compat-cognition';
  const bundle: MemoryBundle = {
    format: 'memoweft-bundle',
    schemaVersion: 1,
    exportedAt: now,
    memoWeftVersion: '0.5.1',
    subjectId,
    source: { hostId: 'weftmate-compat-test', exportMode: 'full' },
    data: {
      evidence: [],
      events: [],
      eventEvidence: [],
      cognitions: [
        {
          id: cognitionId,
          subjectId,
          content: '用户喜欢徒步旅行',
          contentType: 'preference',
          formedBy: 'stated',
          confidence: 900,
          credStatus: 'stable',
          scope: null,
          validAt: null,
          invalidAt: null,
          askedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      cognitionEvidence: [],
      unconsolidatedEventIds: [],
    },
    metadata: {
      counts: { evidence: 0, events: 0, cognitions: 1 },
      notes: ['WeftMate consumer compatibility fixture'],
    },
  };

  const core = createMemoWeftCore({
    dbPath: ':memory:',
    llm: {
      callCount: 0,
      async chat() {
        throw new Error('兼容性测试不应调用真实模型');
      },
    },
  });
  try {
    assert.equal(core.health().embedReady, false, '测试必须走无 embedding 的关键词召回路径');

    const imported = core.portable.importBundle(bundle, { mode: 'merge' });
    assert.equal(imported.valid, true, imported.errors.join('\n'));
    assert.equal(imported.counts.cognitions, 1, '应导入一条 cognition');

    const updated = await core.updateProfile({ subjectId });
    assert.equal(updated.indexError, null, updated.indexError ?? undefined);
    assert.equal(updated.indexed, 1, 'updateProfile 应把导入的 cognition 写入关键词索引');

    const recalled = await core.recall({ subjectId, query: '徒步旅行' });
    assert.ok(recalled.length > 0, '无 embedding 时关键词召回应非空');
    assert.ok(recalled.some((item) => item.id === cognitionId), '应召回导入的 cognition');

    const exported = core.portable.exportBundle({ subjectId });
    assert.equal(exported.memoWeftVersion, '0.5.1');
  } finally {
    core.close();
    for (const [key, value] of savedEmbedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
