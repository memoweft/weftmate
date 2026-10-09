import { scheduledCommandSource } from './schedules-authorization.mjs';
import { digest, failure, id, validId, withDeadline } from './common.mjs';
import { canonicalArtifact } from '../personal-artifacts/index.mjs';
import { INTERNAL_ARTIFACT_KIND, MAX_COMMANDS, SNAPSHOT_ID, WEB_SNAPSHOT_ID } from './constants.mjs';
import { canonicalCommand, publicCommand, sourceMessageHash } from './command-policy.mjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { MAX_ARTIFACT_BYTES, validArtifactFileName } from '../personal-artifacts/index.mjs';

export function createArtifactOperations(context) {
  const operations = {
    /** Only the trusted native-tool observer calls this; file bytes come from disk. */
    async registerNativeFile(input) {
      const { filePath, sha256, sessionId } = input;
      id(sessionId);
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
          typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw failure('INVALID_COMMAND');
      const file = await realpath(filePath);
      const stat = await lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw failure('INVALID_COMMAND');
      const fileName = path.basename(file).normalize('NFC');
      // Keep the current clients' text artifact contract; native tools can still write any file.
      if (!validArtifactFileName(fileName) || !stat.size || stat.size > MAX_ARTIFACT_BYTES)
        return { state: 'unavailable', reasonCode: 'ARTIFACT_FORMAT_UNSUPPORTED' };
      const bytes = await readFile(file);
      const content = bytes.toString('utf8');
      if (content.includes('\0') || !Buffer.from(content, 'utf8').equals(bytes))
        return { state: 'unavailable', reasonCode: 'ARTIFACT_FORMAT_UNSUPPORTED' };
      const artifact = canonicalArtifact(fileName, content);
      if (artifact.sha256 !== sha256) throw failure('ARTIFACT_UNVERIFIED', 409);
      return operations.submitToolArtifact({ ...input, fileName, content,
        nativeFile: file });
    },
    /** Main-process only: create a bounded document from one accepted owner turn. */
    async submitToolArtifact({ sessionId, turn, callId, messageHash, receiptId,
      sourceSnapshotIds, fileName, content, nativeFile }) {
      const ownerId = context.sessionOperations.executionOwnerForSession(sessionId);
      id(sessionId);
      if (!Number.isSafeInteger(turn) || turn < 0 || typeof callId !== 'string' ||
          !/^[A-Za-z0-9._:-]{1,160}$/.test(callId) ||
          typeof messageHash !== 'string' || !/^[a-f0-9]{64}$/.test(messageHash)) {
        throw failure('INVALID_COMMAND');
      }
      let artifact = canonicalArtifact(fileName, content);
      const state = context.accountState(ownerId);
      if (state.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
      const projectSession = nativeFile === undefined && state.sessions[sessionId]?.projectId ? await context.checkedProjectSession(ownerId, sessionId) : null;
      const browserSession = nativeFile === undefined && state.sessions[sessionId]?.workspaceKind === 'browser'
        ? await context.checkedBrowserSession(ownerId, sessionId) : null;
      let citedSources = null;
      if (projectSession) {
        if (!validId(receiptId) || !Array.isArray(sourceSnapshotIds) || sourceSnapshotIds.length < 1 ||
            sourceSnapshotIds.length > 16 || new Set(sourceSnapshotIds).size !== sourceSnapshotIds.length ||
            sourceSnapshotIds.some((sourceId) => !SNAPSHOT_ID.test(sourceId)) ||
            typeof context.verifyToolResult !== 'function') throw failure('PROJECT_SOURCE_UNVERIFIED', 409);
        const { source, rootTaskId } = context.projectToolSource(state,
          { sessionId, turn, messageHash, receiptId });
        citedSources = sourceSnapshotIds.map((sourceId) => {
          const read = state.projectSources?.[sourceId];
          if (!read || read.projectId !== projectSession.project.projectId ||
              read.projectRevision !== projectSession.project.revision || read.taskId !== rootTaskId ||
              read.sourceCommandId !== source.commandId || read.sessionId !== sessionId ||
              read.turn !== turn || read.sourceReceiptId !== receiptId) {
            throw failure('PROJECT_SOURCE_UNVERIFIED', 409);
          }
          return read;
        });
        const proofs = await Promise.all(citedSources.map((read) => withDeadline(() => context.verifyToolResult({
          sessionId, turn, readCallId: read.readCallId, snapshotId: read.snapshotId,
          sourceReceiptId: receiptId, beforeCallId: callId,
        }), 3_500).catch(() => false)));
        if (proofs.some((proof) => proof !== true)) throw failure('PROJECT_SOURCE_UNVERIFIED', 409);
        const manifest = citedSources.map((read) =>
          `- ${read.relativePath}，第 ${read.lineStart}–${read.lineEnd} 行，读取于 ${read.readAt}，SHA-256 ${read.fileSha256}`)
          .join('\n');
        artifact = canonicalArtifact(fileName, `${content.trimEnd()}\n\n## 已读取来源\n${manifest}\n`);
      } else if (browserSession) {
        if (!validId(receiptId) || !Array.isArray(sourceSnapshotIds) || sourceSnapshotIds.length < 1 ||
            sourceSnapshotIds.length > 16 || new Set(sourceSnapshotIds).size !== sourceSnapshotIds.length ||
            sourceSnapshotIds.some((sourceId) => !WEB_SNAPSHOT_ID.test(sourceId)) ||
            typeof context.verifyToolResult !== 'function') throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        const { source, rootTaskId } = context.browserToolSource(state,
          { sessionId, turn, messageHash, receiptId });
        citedSources = sourceSnapshotIds.map((sourceId) => {
          const read = state.browserSources?.[sourceId];
          if (!read || read.ownerId !== ownerId || read.taskId !== rootTaskId ||
              read.sourceCommandId !== source.commandId || read.sessionId !== sessionId ||
              read.turn !== turn || read.sourceReceiptId !== receiptId) {
            throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
          }
          return read;
        });
        const proofs = await Promise.all(citedSources.map((read) => withDeadline(() => context.verifyToolResult({
          sessionId, turn, readCallId: read.readCallId, snapshotId: read.snapshotId,
          sourceReceiptId: receiptId, beforeCallId: callId, readTool: read.readTool,
        }), 3_500).catch(() => false)));
        if (proofs.some((proof) => proof !== true)) throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
        const manifest = citedSources.map((read) =>
          `- 网页：${JSON.stringify(read.title.replace(/\s+/g, ' '))}；地址：${read.url}；读取于 ${read.readAt}；本段 SHA-256 ${read.textSha256}${read.versionHash
            ? `；捕获版本 ${read.versionHash}；第 ${read.segmentIndex + 1}/${read.segmentCount} 段，字节 ${read.byteStart}–${read.byteEnd}（结束位置不含）${read.captureTruncated ? '；本次捕获未覆盖全文' : ''}`
            : read.truncated ? '；正文已截断' : ''}`)
          .join('\n');
        artifact = canonicalArtifact(fileName, `${content.trimEnd()}\n\n## 已读取网页来源\n${manifest}\n`);
      } else if (sourceSnapshotIds !== undefined || receiptId !== undefined) {
        if (sourceSnapshotIds !== undefined && (!Array.isArray(sourceSnapshotIds) || sourceSnapshotIds.length)) {
          throw failure('PROJECT_SOURCE_UNVERIFIED', 409);
        }
      }
      const described = await context.callBackend(() => context.backend.describeSession(sessionId, ownerId));
      if (described?.sessionId !== sessionId || described.agentPreset !== 'personal-remote') {
        throw failure('SESSION_READ_ONLY', 409);
      }
      await context.callBackend(() => context.backend.preflight({ kind: INTERNAL_ARTIFACT_KIND,
        targetDeviceId: state.hostId, sessionId, ownerId }));
      const requestId = `artifact-${digest(`${ownerId}|${sessionId}|${turn}|${callId}${nativeFile === undefined ? '' : `|${nativeFile}|${artifact.sha256}`}`).slice(0, 48)}`;
      const sourceCandidates = () => Object.values(context.accountState(ownerId).commands).filter((item) =>
        item.kind === 'session.message' && item.sessionId === sessionId &&
        typeof item.payload.text === 'string' && sourceMessageHash(item) === messageHash &&
        (receiptId === undefined || item.receiptId === receiptId));
      if (!sourceCandidates().length) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
      for (let attempt = 0; attempt < 20 && sourceCandidates().some((item) => item.state === 'dispatching'); attempt++) {
        if (context.closing) throw failure('SERVICE_CLOSING', 503);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const commandId = await context.serial(() => context.mutate(ownerId, (next) => {
        if (next.sessions[sessionId]?.origin !== 'personal-remote') throw failure('SESSION_READ_ONLY', 409);
        const eligible = Object.values(next.commands).filter((item) => {
          if (item.kind !== 'session.message' || item.sessionId !== sessionId ||
              item.state !== 'accepted_by_dsh' || typeof item.payload.text !== 'string' ||
              sourceMessageHash(item) !== messageHash ||
              (receiptId !== undefined && item.receiptId !== receiptId) ||
              (item.dshTurn !== undefined && item.dshTurn !== turn) ||
              !Number.isSafeInteger(item.sourceAuthEpoch)) return false;
          const device = next.devices[item.sourceDeviceId];
          // Native write receipts belong to the authenticated source device, including
          // cloud desktops and phones. Restricting this to password devices rejects
          // registration after the file was already written (FX-11 / BL-14).
          return ['password', 'cloud'].includes(device?.authKind) && !device.revoked &&
            device.authEpoch === item.sourceAuthEpoch && (scheduledCommandSource(next, item) || Date.parse(device.expiresAt) > context.timestamp());
        });
        if (eligible.length !== 1) throw failure('TOOL_SOURCE_UNAVAILABLE', 403);
        const source = eligible[0];
        const rootTaskId = source.rootTaskId ?? source.commandId;
        if (projectSession) {
          const grant = context.projectGrant(next, sessionId);
          if (grant.project.projectId !== projectSession.project.projectId ||
              grant.project.revision !== projectSession.project.revision ||
              source.payload.projectId !== grant.project.projectId ||
              source.payload.projectRevision !== grant.project.revision ||
              citedSources.some((read) => next.projectSources?.[read.snapshotId]?.sourceCommandId !== source.commandId)) {
            throw failure('PROJECT_SOURCE_UNVERIFIED', 409);
          }
        }
        if (browserSession) {
          if (next.sessions[sessionId]?.workspaceKind !== 'browser' ||
              next.sessions[sessionId]?.modelProfileId !== browserSession.modelProfileId ||
              source.payload.workspaceKind !== 'browser' ||
              citedSources.some((read) => next.browserSources?.[read.snapshotId]?.sourceCommandId !== source.commandId)) {
            throw failure('BROWSER_SOURCE_UNVERIFIED', 409);
          }
        }
        const existing = Object.values(next.commands).find((item) => item.requestId === requestId);
        if (existing) {
          if (existing.kind !== INTERNAL_ARTIFACT_KIND || existing.taskId !== rootTaskId ||
              existing.fileName !== artifact.fileName || existing.size !== artifact.size ||
              existing.sha256 !== artifact.sha256 ||
              JSON.stringify(existing.sourceSnapshotIds ?? null) !== JSON.stringify(sourceSnapshotIds ?? null)) {
            throw failure('REQUEST_CONFLICT', 409);
          }
          return existing.commandId;
        }
        if (context.requestIdUsed(next, requestId)) throw failure('REQUEST_CONFLICT', 409);
        if (next.commands[rootTaskId]?.taskControl?.state === 'stop_requested') {
          throw failure('TASK_NOT_READY', 409);
        }
        if (Object.keys(next.commands).length >= MAX_COMMANDS) throw failure('CAPACITY_LIMIT', 429);
        source.dshTurn = turn;
        const commandId = `cmd-${randomUUID()}`;
        const artifactId = `artifact-${randomUUID()}`;
        const payload = canonicalCommand({ requestId, kind: INTERNAL_ARTIFACT_KIND,
          targetDeviceId: next.hostId, sessionId, taskId: rootTaskId, artifactId,
          fileName: artifact.fileName, size: artifact.size, sha256: artifact.sha256,
          ...(projectSession || browserSession ? { sourceReceiptId: receiptId, sourceSnapshotIds } : {}) }, next.hostId, true);
        const now = new Date(context.timestamp()).toISOString();
        next.commands[commandId] = { commandId, ownerId, requestId,
          ...(nativeFile !== undefined ? { nativeFileObserved: true } : {}),
          payloadHash: digest(JSON.stringify(payload)), payload,
          sourceDeviceId: source.sourceDeviceId, sourceAuthEpoch: source.sourceAuthEpoch,
          targetDeviceId: next.hostId, kind: INTERNAL_ARTIFACT_KIND, sessionId,
          taskId: rootTaskId, artifactId, fileName: artifact.fileName,
          contentType: artifact.contentType, size: artifact.size, sha256: artifact.sha256,
          ...(projectSession || browserSession ? { sourceReceiptId: receiptId, sourceSnapshotIds } : {}),
          toolSource: { sessionId, turn, callId, sourceCommandId: source.commandId },
          state: 'dispatching', createdAt: now, updatedAt: now };
        return commandId;
      }));
      const command = context.accountState(ownerId).commands[commandId];
      if (command.state !== 'dispatching') return publicCommand(command);
      const workKey = `${ownerId}|${commandId}`;
      let work = context.activeByCommand.get(workKey);
      if (!work) {
        work = (async () => {
          let observed = false;
          try {
            try { await context.artifactStore.inspect(ownerId, command.taskId, command.artifactId, command); observed = true; }
            catch (error) {
              if (error?.code !== 'ENOENT') throw error;
              await context.artifactStore.write(ownerId, command.taskId, command.artifactId, artifact);
              observed = true;
            }
          } catch { /* A write may have completed before its receipt failed. Recheck below. */ }
          if (!observed) {
            try { await context.artifactStore.inspect(ownerId, command.taskId, command.artifactId, command); observed = true; }
            catch { /* Keep unknown result. */ }
          }
          await context.serial(() => context.mutate(ownerId, (next) => {
            const current = next.commands[commandId];
            if (current.state !== 'dispatching') return;
            current.state = observed ? 'observed' : 'uncertain';
            if (observed) current.verification = { status: 'observed', method: 'sha256_readback',
              observedAt: new Date(context.timestamp()).toISOString() };
            else current.errorCode = 'RECEIPT_UNKNOWN';
            current.updatedAt = new Date(context.timestamp()).toISOString();
          }));
        })();
        context.activeByCommand.set(workKey, work);
        work.finally(() => { if (context.activeByCommand.get(workKey) === work) context.activeByCommand.delete(workKey); }).catch(() => {});
      }
      await work;
      return publicCommand(context.accountState(ownerId).commands[commandId]);
    }
  };
  return operations;
}
