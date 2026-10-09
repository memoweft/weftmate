import { randomUUID } from 'node:crypto';
import { browserCaptureSegments } from '../personal-browser/index.mjs';
import { failure } from './common.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { sessionWorkspace } from './session-workspace.mjs';

/** A verbatim lead, cut at a paragraph boundary; never a fabricated summary. */
export function pagePreview(text, limit = 4096) {
  if (text.length <= limit) return text;
  const lead = text.slice(0, limit);
  const boundary = lead.lastIndexOf('\n\n');
  return lead.slice(0, boundary >= limit / 2 ? boundary : limit);
}

/** Targeted verbatim paragraphs, with offsets into the frozen captured text. */
export function pageExcerpts(text, query, limit = 4096) {
  const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = [];
  let used = 0;
  for (const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {
    if (!terms.some(term => match[0].toLocaleLowerCase().includes(term))) continue;
    const remaining = limit - used;
    if (remaining <= 0) break;
    const paragraph = match[0].slice(0, remaining);
    matches.push({ charStart: match.index, charEnd: match.index + paragraph.length, text: paragraph });
    used += paragraph.length;
  }
  return matches;
}

/** One browser capability for every owner conversation, independent of its task wording. */
export function createNativeBrowserOperations(context) {
  const captures = new Map();
  return {
    async browse(input) {
      const { sessionId, browserAction, snapshotId, segmentIndex = 0, linkId } = input;
      const ownerId = context.sessionOperations.executionOwnerForSession(sessionId);
      const session = context.accountState(ownerId).sessions[sessionId];
      if (session?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
      if (!['open', 'read', 'follow'].includes(browserAction)) throw failure('INVALID_COMMAND');
      const { root } = context.personalExecutionSource(context.accountState(ownerId), input, true);
      const rootTaskId = root.commandId;
      const prior = captures.get(snapshotId);
      if (browserAction !== 'open' && (!prior || prior.sessionId !== sessionId))
        throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
      if (browserAction === 'read') {
        if (input.query !== undefined) {
          if (typeof input.query !== 'string' || !input.query.trim()) throw failure('INVALID_COMMAND');
          const excerpts = pageExcerpts(prior.segments.map(segment => segment.text).join(''), input.query);
          return { snapshotId, url: prior.result.url, title: prior.result.title, sourcePath: prior.result.sourcePath,
            query: input.query, excerpts, truncated: true,
            text: excerpts.length ? excerpts.map(e => `[characters ${e.charStart}-${e.charEnd}]\n${e.text}`).join('\n\n') : 'No matching captured paragraph. Try different terms or read an exact segment.' };
        }
        if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= prior.segments.length)
          throw failure('INVALID_COMMAND');
        // Avoid replaying the same 50-link navigation and outline on every
        // segment. Links remain available from the original capture for follow.
        return { ...prior.result, links: [], outline: undefined, previewTruncated: false,
          segmentIndex, text: prior.segments[segmentIndex].text };
      }
      const url = browserAction === 'open' ? input.url : prior.result.links.find(link => link.linkId === linkId)?.url;
      if (typeof url !== 'string') throw failure('BROWSER_LINK_UNAVAILABLE', 409);
      const read = await context.browserReader.read({ ownerId, taskId: rootTaskId,
        sessionId, receiptId: input.receiptId, callId: input.callId, url });
      context.personalExecutionSource(context.accountState(ownerId), input, true);
      const captureId = `capture-${randomUUID()}`;
      const segments = browserCaptureSegments(Buffer.from(read.capturedText, 'utf8'));
      // Store the captured source in the conversation's own workspace, including
      // for read-only projects. No network text is executed or used as a path.
      const directory = join(sessionWorkspace(join(dirname(context.root), 'conversations'), ownerId, sessionId), '.weftmate-web-sources');
      await mkdir(directory, { recursive: true });
      const sourcePath = join(directory, `${captureId}.txt`);
      await writeFile(sourcePath, `Source: ${read.url}\nTitle: ${read.title}\nCaptured: ${new Date().toISOString()}\nCapture truncated: ${read.captureTruncated === true}\n\n${read.capturedText}`, { flag: 'wx' });
      const result = { snapshotId: captureId, url: read.url, title: read.title,
        text: pagePreview(segments[0].text), sourcePath, previewTruncated: pagePreview(segments[0].text).length < segments[0].text.length,
        links: read.links, outline: read.outline,
        segmentIndex: 0, segmentCount: segments.length, truncated: read.truncated,
        captureTruncated: read.captureTruncated === true, httpStatus: read.httpStatus ?? 200 };
      captures.set(captureId, { sessionId, segments, result });
      return result;
    },
  };
}
