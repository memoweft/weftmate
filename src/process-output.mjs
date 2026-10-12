/** Install before any application imports can warn. Console output is best effort. */
export function protectProcessOutput(target = process) {
  const pending = [];
  let sink;
  for (const stream of [target.stdout, target.stderr]) {
    if (!stream) continue;
    // All output failures are harmless, including EPIPE, EOF and destroyed streams.
    stream.on('error', () => {});
    const write = stream.write.bind(stream);
    stream.write = (...args) => { try { return write(...args); } catch { return false; } };
  }
  // Node's default warning listener writes the full warning to stderr. Replace
  // that listener alone; preserve listeners installed by application libraries.
  for (const listener of target.listeners('warning')) if (listener.name === 'onWarning') target.removeListener('warning', listener);
  const warning = value => {
    const clean = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : 'unknown';
    const data = { name: clean(value?.name), code: clean(value?.code) };
    if (sink) { try { sink('process.warning', data); } catch {} }
    else pending.push(data);
  };
  target.on('warning', warning);
  return write => { sink = write; for (const data of pending.splice(0)) { try { sink('process.warning', data); } catch {} } };
}
export const setProcessWarningLog = protectProcessOutput();
