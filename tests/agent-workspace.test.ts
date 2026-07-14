import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT_WORKSPACE_NAME, ensureDefaultAgentWorkspace } from '../src/agent-workspace.ts';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('默认 Agent 工作区', () => {
  it('未配置时在文档目录下创建专用 WeftMate 文件夹，并可重复调用', () => {
    root = mkdtempSync(join(tmpdir(), 'weftmate-documents-'));
    const first = ensureDefaultAgentWorkspace(root);
    const second = ensureDefaultAgentWorkspace(root);

    assert.equal(first, join(root, DEFAULT_AGENT_WORKSPACE_NAME));
    assert.equal(second, first);
    assert.equal(existsSync(first), true);
    assert.equal(statSync(first).isDirectory(), true);
  });
});
