import { failure, publicSource } from './common.mjs';
import { publicCommand } from './command-policy.mjs';
import { INTERNAL_ARTIFACT_KIND } from './constants.mjs';
import { describeTool } from '../runtime/dsh-adapter/timeline.mjs';

const parsed = value => { if (typeof value !== 'string') return value ?? {}; try { return JSON.parse(value); } catch { return {}; } };
const strings = value => (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string' && value.trim());

function describeUse(tool, args, fallback) {
  const short = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (/^(weftmod_script|run_code)$/.test(tool)) return `运行脚本${args.description ? `：${short(args.description)}` : ''}`;
  const description = describeTool(tool, args);
  const file = strings(args.file_path ?? args.filePath ?? args.path)[0]?.split(/[\\/]/).at(-1);
  if (file && /^(读取文件|写入文件|修改文件)$/.test(description)) return `${description}：${short(file)}`;
  if (description === '调用扩展服务' || description.startsWith('执行工具 ')) {
    if (args.description) return short(args.description);
    if (fallback && fallback !== description && fallback !== tool) return short(fallback);
    return `调用 ${short(tool)}${args.query ? `：${short(args.query)}` : ''}`;
  }
  return description;
}

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
  // Artifacts are named exports within a conversation. Keep the newest version;
  // creation time, not later status updates, determines the write order.
  const latest = new Map();
  for (const row of Object.values(account.commands).filter(row => row.sessionId === sessionId && row.kind === INTERNAL_ARTIFACT_KIND)) {
    const key = row.fileName || row.artifactId, previous = latest.get(key);
    if (!previous || Date.parse(row.createdAt) >= Date.parse(previous.createdAt) || !previous.createdAt) latest.set(key, row);
  }
  const outputs = [...latest.values()].map(publicCommand);
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
    const step = event.type === 'artifact.created' ? event.data?.completedStep
      : event.type.startsWith('step.') || ['question.asked', 'question.answered'].includes(event.type) ? event.data : null;
    if (!step?.toolName || !step.detailRef) continue;
    const tool = step.toolName, use = { id: `${step.taskId}/${step.stepId}`, callId: step.callId || step.stepId, seq: event.seq, at: event.at,
      summary: step.summary || tool, path: `/sessions/${encodeURIComponent(sessionId)}/events/${step.detailRef.seq}/detail` };
    sources.push({ key: `tool:${tool}`, kind: 'tool', name: tool, uses: [use] });
    // Only expose call parameters. Raw output stays behind the existing detail endpoint.
    if (typeof context.backend.readEventDetail !== 'function') continue;
    let args, browserResult;
    try { const detail = await context.callBackend(() => context.backend.readEventDetail({ sessionId, ownerId, seq: step.detailRef.seq }));
      const data = parsed(detail.text);
      args = parsed(data.arguments);
      const texts = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(texts)
        : value?.type === 'text' ? [value.text] : value?.content ? texts(value.content) : [];
      if (tool === 'browser') {
        browserResult = texts(data.output).map(parsed).find(value => typeof value?.url === 'string');
        if (browserResult?.capturedFragment) {
          const capturedUrl = new URL(browserResult.url);
          capturedUrl.hash = browserResult.capturedFragment;
          browserResult = { ...browserResult, url: capturedUrl.href };
        }
      } else if (tool === 'web_fetch') {
        // DSH's controlled fetch header identifies the final URL after redirects.
        const rendered = texts(data.output).find(text => /^Fetched https?:\/\//.test(text));
        const address = rendered?.match(/^Fetched (https?:\/\/\S+) \(HTTP \d+\)/)?.[1];
        if (address) browserResult = { url: address, title: rendered.match(/\nTitle: ([^\n]+)/)?.[1] };
      }
    } catch { continue; }
    use.summary = describeUse(tool, args, step.summary);
    if (tool === 'browser' && args.query) use.summary = `原文片段 · ${String(args.query).slice(0, 100)}`;
    const paths = [...strings(args.file_path), ...strings(args.path), ...strings(args.paths), ...strings(args.filePath)];
    for (const file of new Set(paths)) sources.push({ key: `file:${file}`, kind: 'file', name: file.split(/[\\/]/).at(-1), location: file,
      uses: [{ ...use, verb: /write|save|edit/i.test(tool) ? '写入' : '读取' }] });
    for (const url of new Set([...strings(args.url), ...strings(args.urls), ...strings(browserResult?.url)])) {
      try { if (!['http:', 'https:'].includes(new URL(url).protocol)) continue; } catch { continue; }
      sources.push({ key: `webpage:${url}`, kind: 'webpage', name: browserResult?.title || url, url, uses: [use] });
    }
  }
  return { outputs, sources, nextSeq: page.nextSeq, hasMore: page.hasMore };
}
