import { failure, publicSource } from './common.mjs';
import { publicCommand } from './command-policy.mjs';
import { INTERNAL_ARTIFACT_KIND } from './constants.mjs';

const parsed = value => { if (typeof value !== 'string') return value ?? {}; try { return JSON.parse(value); } catch { return {}; } };
const strings = value => (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value.trim());

/** Read-only projection of existing account records and one directional timeline page. */
export async function conversationResources(context, account, sessionId, ownerId, afterSeq) {
  // A newly created personal conversation has no native log until its first message.
  if (afterSeq === -1 && account.sessions?.[sessionId]?.origin === 'personal-remote' &&
      !Object.values(account.commands).some(row => row.sessionId === sessionId && row.kind === 'session.message')) {
    return { outputs: [], sources: [], nextSeq: -1, hasMore: false };
  }
  const page = await context.callBackend(() => context.backend.readEvents({ sessionId, ownerId, afterSeq, limit: 200 }));
  if (!Array.isArray(page?.events) || page.events.length > 200 || typeof page.hasMore !== 'boolean' || !Number.isSafeInteger(page.nextSeq) ||
      page.hasMore && page.nextSeq <= afterSeq) throw failure('BACKEND_UNAVAILABLE', 503);
  let last = afterSeq;
  for (const event of page.events) {
    if (!Number.isSafeInteger(event?.seq) || event.seq <= last) throw failure('BACKEND_UNAVAILABLE', 503);
    last = event.seq;
  }
  const outputs = Object.values(account.commands).filter(row => row.sessionId === sessionId && row.kind === INTERNAL_ARTIFACT_KIND).map(publicCommand);
  const sources = [...Object.values(account.projectSources ?? {}), ...Object.values(account.browserSources ?? {})]
    .filter(row => row.sessionId === sessionId && row.ownerId === ownerId).map(row => ({
      key: `${row.kind === 'webpage' ? 'webpage' : 'file'}:${row.url || row.relativePath}`,
      kind: row.kind === 'webpage' ? 'webpage' : 'file', name: row.title || row.relativePath,
      ...(row.url ? { url: row.url } : {}),
      uses: [{ id: row.readCallId || row.snapshotId, ...(row.readCallId ? { callId: row.readCallId } : {}), at: row.readAt, summary: '读取',
        path: `/tasks/${encodeURIComponent(row.taskId)}/sources/${encodeURIComponent(row.snapshotId)}` }],
      source: publicSource(row),
    }));
  for (const event of page.events) {
    const step = event.type === 'artifact.created' ? event.data?.completedStep : event.type.startsWith('step.') ? event.data : null;
    if (!step?.toolName || !step.detailRef) continue;
    const tool = step.toolName, use = { id: `${step.taskId}/${step.stepId}`, callId: step.callId || step.stepId, seq: event.seq, at: event.at,
      summary: step.summary || tool, path: `/sessions/${encodeURIComponent(sessionId)}/events/${step.detailRef.seq}/detail` };
    sources.push({ key: `tool:${tool}`, kind: 'tool', name: tool, uses: [use] });
    // Only expose call parameters. Raw output stays behind the existing detail endpoint.
    if (typeof context.backend.readEventDetail !== 'function') continue;
    let args;
    try { const detail = await context.callBackend(() => context.backend.readEventDetail({ sessionId, ownerId, seq: step.detailRef.seq }));
      args = parsed(parsed(detail.text).arguments); } catch { continue; }
    const paths = [...strings(args.file_path), ...strings(args.path), ...strings(args.paths), ...strings(args.filePath)];
    for (const file of new Set(paths)) sources.push({ key: `file:${file}`, kind: 'file', name: file.split(/[\\/]/).at(-1), location: file,
      uses: [{ ...use, verb: /write|save|edit/i.test(tool) ? '写入' : '读取' }] });
    for (const url of new Set([...strings(args.url), ...strings(args.urls)])) {
      try { if (!['http:', 'https:'].includes(new URL(url).protocol)) continue; } catch { continue; }
      sources.push({ key: `webpage:${url}`, kind: 'webpage', name: url, url, uses: [use] });
    }
  }
  return { outputs, sources, nextSeq: page.nextSeq, hasMore: page.hasMore };
}
