import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatHistory } from '../src/chatHistory.ts';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function freshHistory() {
  root = mkdtempSync(join(tmpdir(), 'weftmate-sessions-'));
  return createChatHistory(root);
}

describe('会话工作区持久化', () => {
  it('元数据会让空白新会话立即可见，且不会混入聊天消息', () => {
    const history = freshHistory();
    const workspace = join(root, 'project-a');

    history.setWorkspace('session-a', workspace);

    assert.equal(history.getWorkspace('session-a'), workspace);
    assert.deepEqual(history.read('session-a'), []);
    assert.deepEqual(history.list().map((s) => ({ id: s.id, workspace: s.workspace, preview: s.preview })), [
      { id: 'session-a', workspace, preview: '' },
    ]);
  });

  it('最后一次工作区绑定生效，并随归档与恢复保留', () => {
    const history = freshHistory();
    const first = join(root, 'project-a');
    const second = join(root, 'project-b');
    history.setWorkspace('session-a', first);
    history.setWorkspace('session-a', second);
    history.append('session-a', { role: 'user', content: '继续这个项目', ts: new Date().toISOString() });

    history.archive('session-a');
    assert.equal(history.getWorkspace('session-a'), second);
    assert.equal(history.list({ includeArchived: true })[0]?.workspace, second);

    history.append('session-a', { role: 'assistant', content: '好', ts: new Date().toISOString() });
    assert.equal(history.getWorkspace('session-a'), second);
    assert.deepEqual(history.read('session-a').map((turn) => turn.content), ['继续这个项目', '好']);
  });

  it('旧的纯消息 JSONL 仍可读取，损坏行不影响后续绑定', () => {
    const history = freshHistory();
    appendFileSync(join(root, 'legacy.jsonl'), [
      JSON.stringify({ role: 'user', content: '旧对话', ts: '2026-01-01T00:00:00.000Z' }),
      '{bad json',
      '',
    ].join('\n'), 'utf-8');

    assert.equal(history.getWorkspace('legacy'), '');
    assert.equal(history.read('legacy')[0]?.content, '旧对话');
    history.setWorkspace('legacy', join(root, 'default'));
    assert.equal(history.read('legacy')[0]?.content, '旧对话');
    assert.equal(history.list()[0]?.workspace, join(root, 'default'));
  });
});

describe('会话图片资源', () => {
  it('图片与历史引用分开落盘，重建历史实例后仍可读', () => {
    const history = freshHistory();
    const image = history.saveImage('session-a', {
      name: '截图.png', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    assert.ok(image);
    history.append('session-a', {
      role: 'user', content: '看看这张图', ts: new Date().toISOString(), attachments: [image],
    });

    const jsonl = readFileSync(join(root, 'session-a.jsonl'), 'utf-8');
    assert.equal(jsonl.includes('data:image'), false, '会话 JSONL 不应写入 base64');
    assert.equal(JSON.parse(jsonl.trim()).attachments[0].assetId, image.assetId);

    const reopened = createChatHistory(root);
    assert.deepEqual(reopened.read('session-a')[0]?.attachments, [image]);
    const restored = reopened.readImage('session-a', image.assetId);
    assert.equal(restored?.mime, 'image/png');
    assert.deepEqual(restored?.data, Buffer.from('89504e470d0a1a0a', 'hex'));
  });

  it('拒绝伪造类型和越界资源 id', () => {
    const history = freshHistory();
    assert.equal(history.saveImage('session-a', {
      name: 'fake.png', mime: 'image/png', dataUrl: 'data:image/png;base64,SGVsbG8=',
    }), null);
    assert.equal(history.readImage('session-a', '../secret.png'), null);
    assert.equal(history.readImage('../other', 'img-test.png'), null);
    assert.equal(history.readImage('..', 'img-test.png'), null);
    assert.equal(history.saveImage('..', {
      name: '截图.png', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }), null);
  });
});
