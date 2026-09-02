import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blocksUnexpectedRendererNavigation, isExactRuntimeOrigin, isTrustedRendererInvocation } from '../src/renderer-trust.ts';

describe('main renderer navigation and IPC trust fence', () => {
  const expected = 'http://127.0.0.1:43123';

  it('permits only the exact current runtime origin and blocks every other local or remote URL', () => {
    assert.equal(blocksUnexpectedRendererNavigation(expected, expected), false);
    assert.equal(blocksUnexpectedRendererNavigation(`${expected}/session/one`, expected), false);
    for (const unexpected of ['http://127.0.0.1:43124/', 'http://localhost:43123/', 'file:///D:/WeftMate/src/web/other.html', 'https://example.invalid/', 'not a url']) {
      assert.equal(blocksUnexpectedRendererNavigation(unexpected, expected), true, unexpected);
    }
    assert.equal(isExactRuntimeOrigin('http://127.0.0.1:43123/settings', expected), true);
    assert.equal(isExactRuntimeOrigin('http://127.0.0.1:43124/settings', expected), false);
  });

  it('accepts only the expected webContents main frame at the exact canonical URL', () => {
    const sender = {}; const mainFrame = { url: expected };
    assert.equal(isTrustedRendererInvocation({ expectedOrigin: expected, sender, expectedSender: sender, senderFrame: mainFrame, mainFrame }), true);
    assert.equal(isTrustedRendererInvocation({ expectedOrigin: expected, sender, expectedSender: sender, senderFrame: { url: 'http://127.0.0.1:43124/' }, mainFrame }), false, 'same webContents on another origin');
    assert.equal(isTrustedRendererInvocation({ expectedOrigin: expected, sender, expectedSender: sender, senderFrame: { url: expected }, mainFrame }), false, 'subframe must not inherit main-frame authority');
    assert.equal(isTrustedRendererInvocation({ expectedOrigin: expected, sender: {}, expectedSender: sender, senderFrame: mainFrame, mainFrame }), false, 'another webContents is not trusted');
  });
});
