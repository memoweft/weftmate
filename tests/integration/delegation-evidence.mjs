/** Reduce native events to public delegation facts, without prompts or ids. */
export function delegationEvidence(native, parentSessionIds) {
  const parents = new Set(parentSessionIds);
  const calls = native.filter(event => event.type === 'tool/call').map(event => {
    let args = event.data.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return { ...event, data: { ...event.data, arguments: args ?? {} } };
  });
  const results = new Map();
  const resultIndexes = new Map();
  for (const event of native.filter(event => event.type === 'tool/result')) {
    for (const block of event.data.message?.content ?? []) {
      if (block.type === 'tool-result') {
        results.set(block.toolCallId, block);
        resultIndexes.set(block.toolCallId, native.indexOf(event));
      }
    }
  }
  const text = result => (result?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  const parentCalls = calls.filter(event => parents.has(event.sessionId));
  const summaryIndex = native.findIndex(event => event.type === 'tool/call' && parents.has(event.sessionId) &&
    event.data.name === 'write' && String(event.data.arguments).includes('summary.md'));
  const jobs = parentCalls.filter(event => event.data.name === 'subagent').map(event => {
    const result = results.get(event.data.callId);
    const jobId = text(result).match(/started background subagent task (\S+)/)?.[1];
    const collections = jobId ? parentCalls.filter(call => call.data.name === 'job_output' && call.data.arguments.job_id === jobId) : [];
    const terminalReads = collections.filter(call => /\[status: (completed|failed|killed)[,\]]/.test(text(results.get(call.data.callId))));
    const collectedIndex = jobId ? resultIndexes.get(terminalReads.at(-1)?.data.callId) : resultIndexes.get(event.data.callId);
    return { background: event.data.arguments.run_in_background === true, returnedJobId: !!jobId,
      error: result?.isError ?? null,
      foregroundResultReceived: event.data.arguments.run_in_background !== true && !!result && !result.isError,
      collectionCalls: collections.length,
      terminalCollected: terminalReads.length > 0,
      resultReceivedBeforeSummary: summaryIndex >= 0 && collectedIndex !== undefined ? collectedIndex < summaryIndex : null,
      blockingCollection: collections.some(call => call.data.arguments.wait === true) };
  });
  const writes = calls.filter(event => ['write', 'edit'].includes(event.data.name)).map(event => {
    const path = String(event.data.arguments.file_path ?? event.data.arguments.path ?? '').replaceAll('\\', '/');
    const file = path.match(/(?:^|\/)(reviews\/review-\d+\.md|summary\.md)$/)?.[1];
    return file ? { file, owner: parents.has(event.sessionId) ? 'parent' : 'child',
      error: results.get(event.data.callId)?.isError ?? null } : null;
  }).filter(Boolean);
  const paths = [...new Set(writes.map(write => write.file))];
  const repeatedWrites = paths.map(file => ({ file, attempts: writes.filter(write => write.file === file) }))
    .filter(row => row.attempts.length > 1);
  const notices = native.filter(event => parents.has(event.sessionId) && event.type === 'user/message' && event.data.source?.plugin === 'tool-jobs');
  return { delegations: jobs, parentJobOutputCalls: parentCalls.filter(event => event.data.name === 'job_output').length,
    nativeCompletionNotices: notices.length,
    reportWriteAttempts: writes, repeatedWrites,
    childToolCalls: calls.filter(event => !parents.has(event.sessionId)).length,
    childCompactions: native.filter(event => !parents.has(event.sessionId) && event.type === 'compaction/end' && !event.data.error).length,
    writeObservation: 'Native write/edit attempts for reviews/review-NN.md and summary.md; arbitrary shell effects are not counted by this field.' };
}
