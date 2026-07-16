import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import {
  consumeLocalDataWipeMarker,
  createLocalDataWipeMarker,
  isSafeWipeTarget,
  localDataWipeLaunchRequest,
  wipeLocalDataFromMarker,
} from '../src/local-data-wipe.ts';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('删除全部 WeftMate 本机数据', () => {
  it('只删除 marker 精确指向的 userData，外部 sentinel 保持不动', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-wipe-test-')); roots.push(root);
    const markerDir = join(root, 'os-temp');
    const userData = join(root, 'user-data');
    const external = join(root, 'workspace');
    mkdirSync(userData, { recursive: true }); mkdirSync(external, { recursive: true });
    writeFileSync(join(userData, 'weftmate.db'), 'private');
    const sentinel = join(external, 'KEEP.txt'); writeFileSync(sentinel, 'keep');
    const marker = createLocalDataWipeMarker({ tempDir: markerDir, userData, now: new Date('2026-07-16T00:00:00Z') });

    assert.throws(() => consumeLocalDataWipeMarker({
      markerPath: marker.markerPath, token: 'wrong', userData, tempDir: markerDir, now: new Date('2026-07-16T00:00:01Z'),
    }), /token/);
    assert.equal(existsSync(marker.markerPath), true, '错误 token 不能消费 marker');

    wipeLocalDataFromMarker({ ...marker, userData, tempDir: markerDir, now: new Date('2026-07-16T00:00:02Z') });
    assert.equal(existsSync(userData), false);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
    assert.equal(existsSync(marker.markerPath), false);
  });

  it('拒绝根目录、目标不匹配和不完整启动参数', () => {
    const root = mkdtempSync(join(tmpdir(), 'weftmate-wipe-guard-')); roots.push(root);
    const markerDir = join(root, 'os-temp');
    const userData = join(root, 'user-data');
    const other = join(root, 'other');
    mkdirSync(userData, { recursive: true }); mkdirSync(other, { recursive: true });
    assert.equal(isSafeWipeTarget(parse(userData).root, parse(userData).root), false);

    const marker = createLocalDataWipeMarker({ tempDir: markerDir, userData });
    const raw = JSON.parse(readFileSync(marker.markerPath, 'utf8')); raw.target = other;
    writeFileSync(marker.markerPath, JSON.stringify(raw));
    assert.throws(() => consumeLocalDataWipeMarker({ ...marker, userData, tempDir: markerDir }), /不是当前 WeftMate userData/);
    assert.equal(existsSync(userData), true);
    assert.equal(existsSync(other), true);

    assert.equal(localDataWipeLaunchRequest(['app']), null);
    assert.throws(() => localDataWipeLaunchRequest(['--weftmate-wipe-marker=x']), /不完整/);
  });
});
