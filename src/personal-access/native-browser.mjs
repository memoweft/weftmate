import { randomUUID } from 'node:crypto';
import { browserCaptureSegments } from '../personal-browser/index.mjs';
import { failure } from './common.mjs';

/** One browser capability for every owner conversation, independent of its task wording. */
export function createNativeBrowserOperations(context) {
  const captures = new Map();
  return {
    async browse(input) {
      const { sessionId, browserAction, snapshotId, segmentIndex = 0, linkId } = input;
      const ownerId = context.rootState.legacyOwnerId;
      const session = context.accountState(ownerId).sessions[sessionId];
      if (session?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
      if (!['open', 'read', 'follow'].includes(browserAction)) throw failure('INVALID_COMMAND');
      const { root } = context.personalExecutionSource(context.accountState(ownerId), input, true);
      const rootTaskId = root.commandId;
      const prior = captures.get(snapshotId);
      if (browserAction !== 'open' && (!prior || prior.sessionId !== sessionId))
        throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
      if (browserAction === 'read') {
        if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= prior.segments.length)
          throw failure('INVALID_COMMAND');
        return { ...prior.result, segmentIndex, text: prior.segments[segmentIndex].text };
      }
      const url = browserAction === 'open' ? input.url : prior.result.links.find(link => link.linkId === linkId)?.url;
      if (typeof url !== 'string') throw failure('BROWSER_LINK_UNAVAILABLE', 409);
      const read = await context.browserReader.read({ ownerId, taskId: rootTaskId,
        sessionId, receiptId: input.receiptId, callId: input.callId, url });
      context.personalExecutionSource(context.accountState(ownerId), input, true);
      const captureId = `capture-${randomUUID()}`;
      const segments = browserCaptureSegments(Buffer.from(read.capturedText, 'utf8'));
      const result = { snapshotId: captureId, url: read.url, title: read.title,
        text: segments[0].text, links: read.links, outline: read.outline,
        segmentIndex: 0, segmentCount: segments.length, truncated: read.truncated };
      captures.set(captureId, { sessionId, segments, result });
      return result;
    },
  };
}
