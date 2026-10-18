// Keep process cleanup independent of servers/storage and of sibling failures.
export async function closeRelayProcesses(procs) {
  const results = await Promise.allSettled([...procs].reverse().map(proc => Promise.resolve().then(() => proc.close())));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'Relay cleanup failed');
}

export function trackRelayChild(child, label) {
  let logs = '', closing;
  child.stdout?.on('data', bytes => { logs += bytes; });
  child.stderr?.on('data', bytes => { logs += bytes; });
  // Install before spawn can fail; wait for close, including drained output.
  const closed = new Promise(resolve => child.once('close', resolve));
  child.on('error', error => { logs += `spawn error: ${error.code}\n`; });
  return { child, label, logs: () => logs, close() {
    return closing ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) { await closed; return; }
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await closed; } finally { clearTimeout(timer); }
    })();
  } };
}

export function relayDiagnostics(t, procs, redact = value => value) {
  const start = Date.now(), events = [];
  const mark = (stage, detail = {}) => {
    try { events.push({ at: new Date().toISOString(), elapsedMs: Date.now() - start, stage, ...detail }); } catch {}
  };
  const observe = (event, child) => {
    try {
      mark(event.stage, event.detail);
      if (child) procs.push(trackRelayChild(child, 'host-frpc-sidecar'));
    } catch {}
  };
  return { mark, observe, dump(status) {
    try {
      for (const event of events) t.diagnostic(redact(JSON.stringify(event)));
      for (const proc of procs) if (proc.child) {
        const logs = proc.logs();
        t.diagnostic(`${proc.label}: exit=${proc.child.exitCode}; signal=${proc.child.signalCode}; log bytes=${Buffer.byteLength(logs)}\n${redact(logs) || '(no output)'}`);
      }
      t.diagnostic(JSON.stringify(status));
    } catch {}
  } };
}
