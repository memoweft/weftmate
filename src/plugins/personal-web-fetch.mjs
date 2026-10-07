/** Native WebRuntime provider backed by the existing authorized public-page reader. */
export function personalWebFetchProvider(bridge, currentExecution, executionIdentity) {
  return {
    id: 'weftmate-public-page',
    available: () => {
      const exec = currentExecution();
      return exec?.agent?.session?.header?.agentPreset === 'personal-remote' &&
        exec.agent.session.header.origin !== 'subagent';
    },
    async fetch({ url }, signal) {
      const identity = executionIdentity(currentExecution());
      const first = await bridge.request({ ...identity, action: 'browse', browserAction: 'open', url }, signal);
      const segments = [first.text];
      for (let segmentIndex = 1; segmentIndex < first.segmentCount; segmentIndex++) {
        const part = await bridge.request({ ...identity, action: 'browse', browserAction: 'read',
          snapshotId: first.snapshotId, segmentIndex }, signal);
        segments.push(part.text);
      }
      return { url: first.url, statusCode: first.httpStatus, body: { kind: 'text', content: segments.join('') },
        truncated: first.captureTruncated };
    },
  };
}
