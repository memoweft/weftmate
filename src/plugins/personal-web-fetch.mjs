/** Native WebRuntime provider backed by the existing authorized public-page reader. */
export function personalWebFetchProvider(bridge, currentExecution, executionIdentity) {
  return {
    id: 'weftmate-public-page',
    available: () => {
      const exec = currentExecution();
      return exec?.agent?.session?.header?.agentPreset === 'personal-remote';
    },
    async fetch({ url }, signal) {
      const identity = executionIdentity(currentExecution());
      const first = await bridge.request({ ...identity, action: 'browse', browserAction: 'open', url }, signal);
      // Preserve the browser's existing progressive page reads. Joining every
      // captured segment feeds navigation, changelogs and unrelated sections
      // into every subsequent model request, even when only the lead is needed.
      const continuation = first.segmentCount > 1 ?
        `\n\n[Partial page: segment 0 of ${first.segmentCount}. Read further captured sections with browser action="read", snapshotId=${JSON.stringify(first.snapshotId)}, segmentIndex=1..${first.segmentCount - 1}. Do not cite unread sections.]\nOutline:\n${first.outline || '(no headings)'}` : '';
      const archive = first.sourcePath ? `\n\nCaptured source: ${first.sourcePath}. Use grep/read for a specific missing fact; this preview is verbatim and may omit later sections.${first.previewTruncated ? ` Read full segment 0 with browser action="read", snapshotId=${JSON.stringify(first.snapshotId)}, segmentIndex=0.` : ''}` : '';
      const citation = `Title: ${first.title || first.url}\nURL: ${first.url}\nAccessed: ${first.capturedAt ?? 'unknown'}\n`;
      return { url: first.url, statusCode: first.httpStatus, body: { kind: 'text', content: citation + first.text + continuation + archive },
        truncated: first.captureTruncated === true || first.segmentCount > 1 || first.previewTruncated === true };
    },
  };
}
