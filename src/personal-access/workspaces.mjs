import { scheduledCommandSource } from './schedules-authorization.mjs';
import { digest, failure, id, publicProject, publicSource, validId, withDeadline } from './common.mjs';
import { browserCaptureSegments, browserCaptureVersion, MAX_SEGMENT_BYTES } from '../personal-browser/index.mjs';
import {
  FILE_ID,
  LINK_ID,
  MAX_BROWSER_CAPTURES,
  MAX_BROWSER_SNAPSHOTS,
  MAX_PROJECT_FILES,
  MAX_SOURCE_SNAPSHOTS,
  WEB_SNAPSHOT_ID
} from './constants.mjs';
import { listProjectFiles, readProjectFile } from '../personal-projects/index.mjs';
import { createHmac, randomBytes } from 'node:crypto';
import { MAX_ARTIFACT_BYTES } from '../personal-artifacts/index.mjs';

export function createWorkspaceOperations(context) {
  const frozenBrowserCapture = async (source) => {
    if (!source?.versionHash || !Array.isArray(source.captureParts))
      throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
    try {
      const parts = await Promise.all(source.captureParts.map((item) => context.artifactStore.inspect(
        source.ownerId, source.taskId, item.id, { size: item.size, sha256: item.sha256 })));
      const bytes = Buffer.concat(parts);
      if (bytes.length !== source.totalCapturedBytes ||
          browserCaptureVersion(source.url, bytes) !== source.versionHash)
        throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
      const segments = browserCaptureSegments(bytes);
      if (segments.length !== source.segmentCount || segments[0].text !==
          (await context.artifactStore.inspect(source.ownerId, source.taskId, source.snapshotId,
            { size: source.textSize, sha256: source.textSha256 })).toString('utf8'))
        throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
      return segments;
    } catch { throw failure('BROWSER_SOURCE_UNVERIFIED', 409); }
  };

  function projectGrant(account, sessionId) {
    const session = account.sessions[sessionId];
    if (session?.origin !== 'personal-remote' || !session.projectId) throw failure('PROJECT_NOT_SELECTED', 409);
    const project = account.projects?.[session.projectId];
    if (!project || project.revoked || project.revision !== session.projectRevision) {
      throw failure('PROJECT_REVOKED', 409);
    }
    return { session, project };
  }

  function projectToolSource(account, { sessionId, turn, messageHash, receiptId }) {
    const eligible = Object.values(account.commands).filter((item) => {
      if (item.kind !== 'session.message' || item.sessionId !== sessionId ||
          item.state !== 'accepted_by_dsh' || item.receiptId !== receiptId ||
          typeof item.payload.text !== 'string' || digest(item.payload.text) !== messageHash ||
          (item.dshTurn !== undefined && item.dshTurn !== turn) ||
          !Number.isSafeInteger(item.sourceAuthEpoch)) return false;
      const device = account.devices[item.sourceDeviceId];
      return device?.authKind === 'password' && !device.revoked &&
        device.authEpoch === item.sourceAuthEpoch && (scheduledCommandSource(account, item) || Date.parse(device.expiresAt) > context.timestamp());
    });
    if (eligible.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    const source = eligible[0];
    const rootTaskId = source.rootTaskId ?? source.commandId;
    const root = account.commands[rootTaskId];
    const session = account.sessions[sessionId];
    if (root?.taskControl?.state === 'stop_requested') throw failure('TASK_NOT_READY', 409);
    if (root?.payload.projectId !== session?.projectId ||
        root?.payload.projectRevision !== session?.projectRevision ||
        source.payload.projectId !== session?.projectId ||
        source.payload.projectRevision !== session?.projectRevision) throw failure('PROJECT_REVOKED', 409);
    return { source, rootTaskId };
  }

  async function checkedProjectSession(ownerId, sessionId) {
    const account = context.accountState(ownerId);
    const { session, project } = projectGrant(account, sessionId);
    const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
    if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote' ||
        described.modelProfileId !== session.modelProfileId) throw failure('PROJECT_MODEL_CHANGED', 409);
    return { session, project };
  }

  async function checkedBrowserSession(ownerId, sessionId) {
    const account = context.accountState(ownerId);
    const session = account.sessions[sessionId];
    if (!context.hostOwner(ownerId) || session?.origin !== 'personal-remote' ||
        session.workspaceKind !== 'browser' || context.browserReader?.status()?.available !== true) {
      throw failure(context.browserReader?.status()?.lastFailure === 'BROWSER_CLEANUP_FAILED'
        ? 'BROWSER_CLEANUP_FAILED' : 'BROWSER_UNAVAILABLE', 409);
    }
    const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
    if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote' ||
        described.modelProfileId !== session.modelProfileId) throw failure('PROJECT_MODEL_CHANGED', 409);
    return session;
  }

  function browserToolSource(account, { sessionId, turn, messageHash, receiptId }) {
    const eligible = Object.values(account.commands).filter((item) => {
      if (item.kind !== 'session.message' || item.sessionId !== sessionId ||
          item.state !== 'accepted_by_dsh' || item.receiptId !== receiptId ||
          item.payload.workspaceKind !== 'browser' ||
          typeof item.payload.text !== 'string' || digest(item.payload.text) !== messageHash ||
          (item.dshTurn !== undefined && item.dshTurn !== turn) ||
          !Number.isSafeInteger(item.sourceAuthEpoch)) return false;
      const device = account.devices[item.sourceDeviceId];
      return device?.authKind === 'password' && !device.revoked &&
        device.authEpoch === item.sourceAuthEpoch && (scheduledCommandSource(account, item) || Date.parse(device.expiresAt) > context.timestamp());
    });
    if (eligible.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
    const source = eligible[0];
    const rootTaskId = source.rootTaskId ?? source.commandId;
    const root = account.commands[rootTaskId];
    if (root?.taskControl?.state === 'stop_requested') throw failure('TASK_NOT_READY', 409);
    if (root?.payload.workspaceKind !== 'browser' ||
        JSON.stringify(root.payload.initialUrls) !== JSON.stringify(source.payload.initialUrls)) {
      throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
    }
    return { source, rootTaskId, root };
  }

  return {
    frozenBrowserCapture,
    projectGrant,
    projectToolSource,
    checkedProjectSession,
    checkedBrowserSession,
    browserToolSource,
    async projectForSession({ sessionId, ownerId = context.rootState.legacyOwnerId }) {
      id(sessionId);
      if (!context.hostOwner(ownerId)) throw failure('NOT_FOUND', 404);
      const session = context.accountState(ownerId).sessions[sessionId];
      if (!session?.projectId) return null;
      const { project } = await checkedProjectSession(ownerId, sessionId);
      return { ...publicProject(project), modelProfileId: session.modelProfileId };
    },
    async browserForSession({ sessionId, ownerId = context.rootState.legacyOwnerId }) {
      id(sessionId);
      if (!context.hostOwner(ownerId)) return null;
      if (context.accountState(ownerId).sessions[sessionId]?.workspaceKind !== 'browser') return null;
      const session = await checkedBrowserSession(ownerId, sessionId);
      return { workspaceKind: 'browser', modelProfileId: session.modelProfileId };
    },
    /** Main-process only: list or read inside the project frozen on this session. */
    async submitToolProject({ action, sessionId, turn, callId, messageHash, receiptId,
      query = '', fileId, startLine = 1 }) {
      const ownerId = context.rootState.legacyOwnerId;
      id(sessionId);
      if (!['list_project', 'read_project'].includes(action) ||
          !Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) ||
          !validId(receiptId) || (action === 'read_project' && !FILE_ID.test(fileId ?? '')) ||
          (action === 'list_project' && fileId !== undefined) ||
          typeof query !== 'string' || Buffer.byteLength(query, 'utf8') > 200 ||
          /[\p{Cc}\p{Cf}]/u.test(query) ||
          !Number.isSafeInteger(startLine) || startLine < 1 || startLine > 1_000_000) {
        throw failure('INVALID_COMMAND');
      }
      const { project, session } = await checkedProjectSession(ownerId, sessionId);
      for (let attempt = 0; attempt < 20 && Object.values(context.accountState(ownerId).commands).some((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        item.state === 'dispatching' && typeof item.payload.text === 'string' &&
        digest(item.payload.text) === messageHash); attempt++) {
        if (context.closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const account = context.accountState(ownerId);
      const { source, rootTaskId } = projectToolSource(account,
        { sessionId, turn, messageHash, receiptId });
      if (action === 'list_project') {
        const listing = await listProjectFiles(project, query);
        const files = listing.files.map((file) => ({
          ...file, fileId: `file-${createHmac('sha256', project.fileSecret)
            .update(`${project.projectId}\0${project.revision}\0${file.relativePath}\0${file.identity}\0${file.size}\0${file.lastWriteTime}`)
            .digest('hex').slice(0, 48)}` }));
        await context.serial(() => context.mutate(ownerId, (next) => {
          const grant = projectGrant(next, sessionId);
          if (grant.project.projectId !== project.projectId || grant.project.revision !== project.revision ||
              grant.session.modelProfileId !== session.modelProfileId) throw failure('PROJECT_REVOKED', 409);
          const checked = projectToolSource(next, { sessionId, turn, messageHash, receiptId });
          if (checked.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
          for (const file of files) {
            if (!Object.hasOwn(grant.project.files, file.fileId) &&
                Object.keys(grant.project.files).length >= MAX_PROJECT_FILES) throw failure('CAPACITY_LIMIT', 429);
            grant.project.files[file.fileId] = { fileId: file.fileId, relativePath: file.relativePath,
              size: file.size, identity: file.identity, lastWriteTime: file.lastWriteTime,
              listedAt: new Date(context.timestamp()).toISOString() };
          }
          checked.source.dshTurn = turn;
        }));
        await checkedProjectSession(ownerId, sessionId);
        projectToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
        return { files: files.map(({ fileId, relativePath, size }) => ({ fileId, relativePath, size })),
          truncated: listing.truncated, scannedCount: listing.scannedCount, skippedCount: listing.skippedCount };
      }
      const file = project.files[fileId];
      if (!file) throw failure('PROJECT_FILE_UNAVAILABLE', 404);
      const snapshotId = `source-${digest(`${ownerId}|${project.projectId}|${project.revision}|${rootTaskId}|${sessionId}|${turn}|${receiptId}|${callId}|${fileId}|${startLine}`).slice(0, 48)}`;
      const existing = account.projectSources?.[snapshotId];
      if (existing) {
        if (existing.sourceCommandId !== source.commandId || existing.readCallId !== callId ||
            existing.fileId !== fileId || existing.lineStart !== startLine) throw failure('REQUEST_CONFLICT', 409);
        const bytes = await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId,
          { size: existing.textSize, sha256: existing.textSha256 });
        await checkedProjectSession(ownerId, sessionId);
        const checked = projectToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
        if (checked.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        return { ...publicSource(existing), text: bytes.toString('utf8') };
      }
      const read = await readProjectFile(project, file, startLine);
      const bytes = Buffer.from(read.text, 'utf8');
      const textSha256 = digest(bytes);
      const readAt = new Date(context.timestamp()).toISOString();
      try { await context.artifactStore.write(ownerId, rootTaskId, snapshotId,
        { bytes, size: bytes.length, sha256: textSha256 }); }
      catch (error) {
        if (error?.code !== 'ARTIFACT_EXISTS') throw error;
        await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId, { size: bytes.length, sha256: textSha256 });
      }
      const saved = await context.serial(() => context.mutate(ownerId, (next) => {
        const grant = projectGrant(next, sessionId);
        if (grant.project.projectId !== project.projectId || grant.project.revision !== project.revision ||
            grant.session.modelProfileId !== session.modelProfileId) throw failure('PROJECT_REVOKED', 409);
        const checked = projectToolSource(next, { sessionId, turn, messageHash, receiptId });
        if (checked.source.commandId !== source.commandId || checked.rootTaskId !== rootTaskId) {
          throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        }
        const latestFile = grant.project.files[fileId];
        if (!latestFile || latestFile.relativePath !== file.relativePath ||
            latestFile.identity !== file.identity || latestFile.size !== file.size ||
            latestFile.lastWriteTime !== file.lastWriteTime) {
          throw failure('PROJECT_FILE_CHANGED', 409);
        }
        next.projectSources ??= {};
        if (next.projectSources[snapshotId]) return next.projectSources[snapshotId];
        if (Object.keys(next.projectSources).length >= MAX_SOURCE_SNAPSHOTS) throw failure('CAPACITY_LIMIT', 429);
        checked.source.dshTurn = turn;
        const record = { snapshotId, ownerId, projectId: project.projectId,
          projectRevision: project.revision, taskId: rootTaskId,
          sourceCommandId: source.commandId, sessionId, turn, sourceReceiptId: receiptId,
          readCallId: callId, fileId, relativePath: read.relativePath,
          lineStart: read.lineStart, lineEnd: read.lineEnd, totalLines: read.totalLines,
          fileSha256: read.fileSha256, textSize: bytes.length, textSha256,
          readAt, hasMore: read.hasMore };
        next.projectSources[snapshotId] = record;
        return record;
      }));
      await checkedProjectSession(ownerId, sessionId);
      const checked = projectToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
      if (checked.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      return { ...publicSource(saved), text: read.text };
    },
    /** Main-process only: one browser read from a frozen user URL or observed link. */
    async submitToolBrowser({ action, sessionId, turn, callId, messageHash, receiptId,
      url, snapshotId: linkSnapshotId, linkId, segmentIndex }) {
      const ownerId = context.rootState.legacyOwnerId;
      id(sessionId);
      if (!['open_page', 'follow_link', 'read_segment'].includes(action) ||
          !Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash) ||
          !validId(receiptId) ||
          (action === 'open_page' && (typeof url !== 'string' || linkSnapshotId !== undefined ||
            linkId !== undefined || segmentIndex !== undefined)) ||
          (action === 'follow_link' && (url !== undefined || !WEB_SNAPSHOT_ID.test(linkSnapshotId ?? '') ||
            !LINK_ID.test(linkId ?? '') || segmentIndex !== undefined)) ||
          (action === 'read_segment' && (url !== undefined || linkId !== undefined ||
            !WEB_SNAPSHOT_ID.test(linkSnapshotId ?? '') || !Number.isSafeInteger(segmentIndex) ||
            segmentIndex < 0 || segmentIndex > 31))) throw failure('INVALID_COMMAND');
      await checkedBrowserSession(ownerId, sessionId);
      for (let attempt = 0; attempt < 20 && Object.values(context.accountState(ownerId).commands).some((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        item.state === 'dispatching' && typeof item.payload.text === 'string' &&
        digest(item.payload.text) === messageHash); attempt++) {
        if (context.closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const account = context.accountState(ownerId);
      const { source, rootTaskId, root } = browserToolSource(account,
        { sessionId, turn, messageHash, receiptId });
      if (action === 'read_segment') {
        const parent = account.browserSources?.[linkSnapshotId];
        if (!parent || !parent.versionHash || parent.parentSnapshotId !== undefined ||
            parent.ownerId !== ownerId || parent.taskId !== rootTaskId ||
            parent.sourceCommandId !== source.commandId || parent.sessionId !== sessionId ||
            parent.turn !== turn || parent.sourceReceiptId !== receiptId ||
            !['personal_browser_open', 'personal_browser_follow'].includes(parent.readTool) ||
            segmentIndex >= parent.segmentCount || typeof context.verifyToolResult !== 'function') {
          throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        }
        const proven = await withDeadline(() => context.verifyToolResult({ sessionId, turn,
          readCallId: parent.readCallId, snapshotId: parent.snapshotId,
          sourceReceiptId: receiptId, beforeCallId: callId, readTool: parent.readTool,
          beforeTool: 'personal_browser_read_segment' }), 3_500).catch(() => false);
        if (proven !== true) throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        const snapshotId = `source-${digest(`web-segment|${ownerId}|${rootTaskId}|${sessionId}|${turn}|${receiptId}|${callId}|${parent.snapshotId}|${segmentIndex}`).slice(0, 48)}`;
        const existing = account.browserSources?.[snapshotId];
        if (existing && (existing.sourceCommandId !== source.commandId ||
            existing.readCallId !== callId || existing.parentSnapshotId !== parent.snapshotId ||
            existing.segmentIndex !== segmentIndex || existing.versionHash !== parent.versionHash)) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        const segments = await frozenBrowserCapture(parent);
        const segment = segments[segmentIndex];
        if (!segment) throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        const bytes = Buffer.from(segment.text, 'utf8');
        const textSha256 = digest(bytes);
        if (existing) {
          if (existing.textSha256 !== textSha256 || existing.textSize !== bytes.length ||
              existing.byteStart !== segment.byteStart || existing.byteEnd !== segment.byteEnd)
            throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
          await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId,
            { size: bytes.length, sha256: textSha256 });
          return { ...publicSource(existing), text: segment.text };
        }
        await checkedBrowserSession(ownerId, sessionId);
        const afterRead = browserToolSource(context.accountState(ownerId),
          { sessionId, turn, messageHash, receiptId });
        if (afterRead.source.commandId !== source.commandId)
          throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        try { await context.artifactStore.write(ownerId, rootTaskId, snapshotId,
          { bytes, size: bytes.length, sha256: textSha256 }); }
        catch (error) {
          if (error?.code !== 'ARTIFACT_EXISTS') throw error;
          await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId,
            { size: bytes.length, sha256: textSha256 });
        }
        const saved = await context.serial(() => context.mutate(ownerId, (next) => {
          const checked = browserToolSource(next, { sessionId, turn, messageHash, receiptId });
          const currentParent = next.browserSources?.[linkSnapshotId];
          if (checked.source.commandId !== source.commandId ||
              currentParent?.versionHash !== parent.versionHash ||
              currentParent.sourceReceiptId !== receiptId ||
              currentParent.sourceCommandId !== source.commandId)
            throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
          next.browserSources ??= {};
          if (next.browserSources[snapshotId]) return next.browserSources[snapshotId];
          if (Object.keys(next.browserSources).length >= MAX_BROWSER_SNAPSHOTS)
            throw failure('CAPACITY_LIMIT', 429);
          const record = { kind: 'webpage', snapshotId, ownerId, taskId: rootTaskId,
            sourceCommandId: source.commandId, sessionId, turn, sourceReceiptId: receiptId,
            readCallId: callId, readTool: 'personal_browser_read_segment',
            title: parent.title, url: parent.url, requestedUrl: parent.requestedUrl,
            readAt: new Date(context.timestamp()).toISOString(), textSize: bytes.length, textSha256,
            truncated: parent.captureTruncated || parent.segmentCount > 1, links: [],
            parentSnapshotId: parent.snapshotId, segmentIndex, segmentCount: parent.segmentCount,
            byteStart: segment.byteStart, byteEnd: segment.byteEnd,
            totalCapturedBytes: parent.totalCapturedBytes,
            captureTruncated: parent.captureTruncated, versionHash: parent.versionHash };
          next.browserSources[snapshotId] = record;
          return record;
        }));
        return { ...publicSource(saved), text: segment.text };
      }
      let targetUrl;
      if (action === 'open_page') {
        targetUrl = context.browserReader.canonicalUrl(url);
        if (!root.payload.initialUrls.includes(targetUrl)) throw failure('BROWSER_SOURCE_UNVERIFIED', 403);
      } else {
        const prior = account.browserSources?.[linkSnapshotId];
        if (!prior || prior.ownerId !== ownerId || prior.taskId !== rootTaskId ||
            prior.sessionId !== sessionId || prior.turn !== turn ||
            prior.sourceReceiptId !== receiptId) throw failure('BROWSER_SOURCE_UNVERIFIED', 403);
        const observedLink = prior.links.find((link) => link.linkId === linkId);
        if (!observedLink) throw failure('BROWSER_SOURCE_UNVERIFIED', 403);
        if (typeof context.verifyToolResult !== 'function') throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        const proven = await withDeadline(() => context.verifyToolResult({ sessionId, turn,
          readCallId: prior.readCallId, snapshotId: prior.snapshotId,
          sourceReceiptId: receiptId, beforeCallId: callId,
          readTool: prior.readTool, beforeTool: 'personal_browser_follow' }), 3_500).catch(() => false);
        if (proven !== true) throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        targetUrl = context.browserReader.canonicalUrl(observedLink.url);
      }
      const snapshotId = `source-${digest(`web|${ownerId}|${rootTaskId}|${sessionId}|${turn}|${receiptId}|${callId}|${action}|${targetUrl}`).slice(0, 48)}`;
      const existing = account.browserSources?.[snapshotId];
      if (existing) {
        if (existing.sourceCommandId !== source.commandId || existing.readCallId !== callId ||
            existing.requestedUrl !== targetUrl || existing.readTool !==
              (action === 'open_page' ? 'personal_browser_open' : 'personal_browser_follow')) {
          throw failure('REQUEST_CONFLICT', 409);
        }
        const bytes = await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId,
          { size: existing.textSize, sha256: existing.textSha256 });
        await checkedBrowserSession(ownerId, sessionId);
        const checked = browserToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
        if (checked.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        return { ...publicSource(existing), text: bytes.toString('utf8') };
      }
      if (Object.values(account.browserSources ?? {}).filter((item) =>
        item.versionHash && item.parentSnapshotId === undefined).length >= MAX_BROWSER_CAPTURES)
        throw failure('CAPACITY_LIMIT', 429);
      const read = await context.browserReader.read({ ownerId, taskId: rootTaskId, sessionId,
        receiptId, callId, url: targetUrl });
      const canonicalFinal = context.browserReader.canonicalUrl(read.url);
      if (typeof read.capturedText !== 'string') throw failure('BROWSER_RENDERER_FAILED', 503);
      const captureBytes = Buffer.from(read.capturedText, 'utf8');
      let segments;
      try { segments = browserCaptureSegments(captureBytes); }
      catch { throw failure('BROWSER_RENDERER_FAILED', 503); }
      if (read.requestedUrl !== targetUrl || canonicalFinal !== read.url ||
          typeof read.text !== 'string' || !read.text.trim() ||
          Buffer.byteLength(read.text, 'utf8') > MAX_SEGMENT_BYTES ||
          read.text !== segments[0].text || captureBytes.length !== read.totalCapturedBytes ||
          read.segmentCount !== segments.length ||
          read.versionHash !== browserCaptureVersion(read.url, captureBytes) ||
          typeof read.captureTruncated !== 'boolean' ||
          read.truncated !== (read.captureTruncated || segments.length > 1) ||
          typeof read.outline !== 'string' || Buffer.byteLength(read.outline, 'utf8') > 2 * 1024 ||
          typeof read.title !== 'string' || Array.from(read.title).length > 256 ||
          typeof read.truncated !== 'boolean' || !Array.isArray(read.links) || read.links.length > 50) {
        throw failure('BROWSER_RENDERER_FAILED', 503);
      }
      await checkedBrowserSession(ownerId, sessionId);
      const afterRead = browserToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
      if (afterRead.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      const links = read.links.map((link, index) => {
        if (typeof link.label !== 'string' || Array.from(link.label).length > 160 ||
            typeof link.url !== 'string' || Buffer.byteLength(link.url, 'utf8') > 2048) {
          throw failure('BROWSER_RENDERER_FAILED', 503);
        }
        return { linkId: `link-${digest(`${snapshotId}|${index}|${link.url}|${randomBytes(16).toString('hex')}`).slice(0, 40)}`,
          label: link.label, url: context.browserReader.canonicalUrl(link.url) };
      });
      const bytes = Buffer.from(read.text, 'utf8');
      const textSha256 = digest(bytes);
      const readAt = new Date(context.timestamp()).toISOString();
      const captureParts = [];
      for (let index = 0, offset = 0; offset < captureBytes.length; index++, offset += MAX_ARTIFACT_BYTES) {
        const part = captureBytes.subarray(offset, offset + MAX_ARTIFACT_BYTES);
        const entry = { id: `capture-${snapshotId}-${index}`,
          size: part.length, sha256: digest(part) };
        try { await context.artifactStore.write(ownerId, rootTaskId, entry.id,
          { bytes: part, size: entry.size, sha256: entry.sha256 }); }
        catch (error) {
          if (error?.code !== 'ARTIFACT_EXISTS') throw error;
          await context.artifactStore.inspect(ownerId, rootTaskId, entry.id,
            { size: entry.size, sha256: entry.sha256 });
        }
        captureParts.push(entry);
      }
      try { await context.artifactStore.write(ownerId, rootTaskId, snapshotId,
        { bytes, size: bytes.length, sha256: textSha256 }); }
      catch (error) {
        if (error?.code !== 'ARTIFACT_EXISTS') throw error;
        await context.artifactStore.inspect(ownerId, rootTaskId, snapshotId, { size: bytes.length, sha256: textSha256 });
      }
      const saved = await context.serial(() => context.mutate(ownerId, (next) => {
        if (next.sessions[sessionId]?.workspaceKind !== 'browser' ||
            next.sessions[sessionId]?.modelProfileId !== account.sessions[sessionId].modelProfileId) {
          throw failure('BROWSER_UNAVAILABLE', 409);
        }
        const checked = browserToolSource(next, { sessionId, turn, messageHash, receiptId });
        if (checked.source.commandId !== source.commandId || checked.rootTaskId !== rootTaskId) {
          throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        }
        next.browserSources ??= {};
        if (next.browserSources[snapshotId]) return next.browserSources[snapshotId];
        if (Object.keys(next.browserSources).length >= MAX_BROWSER_SNAPSHOTS) throw failure('CAPACITY_LIMIT', 429);
        if (Object.values(next.browserSources).filter((item) =>
          item.versionHash && item.parentSnapshotId === undefined).length >= MAX_BROWSER_CAPTURES)
          throw failure('CAPACITY_LIMIT', 429);
        checked.source.dshTurn = turn;
        const record = { kind: 'webpage', snapshotId, ownerId, taskId: rootTaskId,
          sourceCommandId: source.commandId, sessionId, turn, sourceReceiptId: receiptId,
          readCallId: callId, readTool: action === 'open_page' ? 'personal_browser_open' : 'personal_browser_follow',
          title: read.title, url: read.url, requestedUrl: targetUrl, readAt,
          textSize: bytes.length, textSha256, truncated: read.truncated, links,
          versionHash: read.versionHash, segmentIndex: 0, segmentCount: segments.length,
          byteStart: 0, byteEnd: bytes.length, totalCapturedBytes: captureBytes.length,
          captureTruncated: read.captureTruncated, outline: read.outline, captureParts };
        next.browserSources[snapshotId] = record;
        return record;
      }));
      await checkedBrowserSession(ownerId, sessionId);
      const checked = browserToolSource(context.accountState(ownerId), { sessionId, turn, messageHash, receiptId });
      if (checked.source.commandId !== source.commandId) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      return { ...publicSource(saved), text: read.text };
    }
  };
}
