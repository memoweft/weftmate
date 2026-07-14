/**
 * 契约测试 · 体验/人格注册表（M3·I3 英文人格一等）。
 * 跑法：node --test "tests/experiences.test.ts"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExperience, listExperiences, EXPERIENCE_IDS } from '../src/experiences/index.ts';

test('I3·英文人格 Aria 已注册且一等（在白名单/可取/在选择器列表）', () => {
  assert.ok(EXPERIENCE_IDS.includes('aria'), 'aria 应在白名单');
  const aria = getExperience('aria');
  assert.equal(aria.id, 'aria');
  assert.equal(aria.name, 'Aria');
  assert.ok(aria.systemPrompt.length > 0, 'systemPrompt 非空');
  // 英文人格的 systemPrompt 应是英文（守双语一等·不半漏中文）
  assert.match(aria.systemPrompt, /You are Aria/);
  // 出现在给前端选择器的列表里（只透 id/name）
  assert.ok(listExperiences().some((e) => e.id === 'aria' && e.name === 'Aria'), 'Aria 应在选择器列表');
});

test('中文人格 星瑶/plain 仍在，未知 id 兜底回退 plain', () => {
  assert.ok(EXPERIENCE_IDS.includes('xingyao') && EXPERIENCE_IDS.includes('plain'));
  assert.equal(getExperience('xingyao').name, '星瑶');
  assert.equal(getExperience('不存在的id').id, 'plain', '未知 id 回退 plain（兜底不破）');
});
