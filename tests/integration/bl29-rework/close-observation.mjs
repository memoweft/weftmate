// Test-only taps in the real close path. No extra awaits, timers or changes to
// the original calls, returned Promises, exceptions or transport completion.
export function instrumentClosePhases(source) {
  source = source.replace('const service = {', `function __reviewClosePhase(phase) {
    try { service.__reviewOnClosePhase?.(phase); } catch { /* Observation only. */ }
  }
  const service = {`);
  source = source.replace('closing = true;', "closing = true; __reviewClosePhase('close.start');")
    .replace('chatTimeline.cancelWaits();', "chatTimeline.cancelWaits(); __reviewClosePhase('waits.revoked');")
    .replace('listeningClosed = new Promise(', "__reviewClosePhase('http.close.start'); listeningClosed = new Promise(")
    .replace('current.close(resolve)', "current.close((...args) => { __reviewClosePhase('http.closed'); resolve(...args); })")
    .replace('current.closeIdleConnections();', "current.closeIdleConnections(); __reviewClosePhase('idle.swept');")
    .replace("response.once('finish', () => { if (closing) candidate.closeIdleConnections(); });",
      "response.once('finish', () => { __reviewClosePhase('response.finished'); if (closing) { candidate.closeIdleConnections(); __reviewClosePhase('idle.swept.after_finish'); } });");
  // Identify which existing cleanup await consumed the interval before the
  // HTTP close. These labels are fixed; never include request or account data.
  for (const name of ['connectors?', 'dataControls', 'memoryIngestion', 'historyImport', 'temporaryChats',
    'activity', 'healthInsights', 'healthOperations', 'healthRecords', 'sideChats', 'chatTimeline', 'offline',
    'hostRelay?', 'hostCloudBackup?']) {
    const call = `await ${name}.close();`, phase = name.replace('?', '');
    source = source.replace(call, `__reviewClosePhase('${phase}.start'); ${call} __reviewClosePhase('${phase}.done');`);
  }
  source = source.replace('await durableWrite(storeFile, next);\n            const previousRoot',
    "__reviewClosePhase('approvals.write.start'); await durableWrite(storeFile, next); __reviewClosePhase('approvals.write.done');\n            const previousRoot")
    .replace('await Promise.race([\n            Promise.all([approvalsClosed',
      "__reviewClosePhase('storage.start'); await Promise.race([\n            Promise.all([approvalsClosed")
    .replace('clearTimeout(timer);\n          await Promise.race([',
      "clearTimeout(timer); __reviewClosePhase('storage.done');\n          __reviewClosePhase('drain.start'); await Promise.race([")
    .replace('current?.closeAllConnections();', "current?.closeAllConnections(); __reviewClosePhase('close.done');");
  return source;
}

export function observeHostClose(t, service, { throwAfterObservation = false } = {}) {
  const phases = [];
  let started;
  function mark(phase) {
    try {
      const at = performance.now();
      if (phase === 'close.start' && started === undefined) started = at;
      if (started !== undefined) phases.push({ phase, ms: Math.round((at - started) * 100) / 100 });
    } catch { /* Observation must not affect the test's behavior. */ }
  }
  service.__reviewOnClosePhase = phase => {
    mark(phase);
    if (throwAfterObservation) throw new Error('synthetic observer failure');
  };
  t.after(() => {
    try { t.diagnostic(JSON.stringify({ kind: 'host-close-phases', phases })); }
    catch { /* Even a failed diagnostic sink must not replace the real error. */ }
    delete service.__reviewOnClosePhase;
  });
  return { mark, phases };
}
