// Measure the observed renderer; never substitute a reference application's numbers.
export async function measureUiAction(page, name, action) {
  await page.evaluate(() => {
    const probe = globalThis.uiFrameProbe = { start: performance.now(), frames: [], longTasks: [], shifts: [], running: true };
    const frame = time => { if (!probe.running) return; if (probe.previous !== undefined) probe.frames.push(time - probe.previous); probe.previous = time; probe.frameId = requestAnimationFrame(frame); };
    probe.frameId = requestAnimationFrame(frame);
    probe.observers = [];
    for (const type of ['longtask', 'layout-shift']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= probe.start) {
        if (type === 'longtask') probe.longTasks.push(entry.duration);
        else probe.shifts.push({ value: entry.value, recentInput: entry.hadRecentInput });
      } }); observer.observe({ type, buffered: true }); probe.observers.push(observer);
    }
  });
  await action();
  return page.evaluate(async name => {
    const probe = globalThis.uiFrameProbe, responseMs = performance.now() - probe.start;
    await new Promise(resolve => setTimeout(resolve, 180));
    probe.running = false; cancelAnimationFrame(probe.frameId); probe.observers.forEach(observer => observer.disconnect());
    const percentile = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * .95)] : null;
    const p95 = percentile(probe.frames);
    return { name, responseMs, sampleMs: performance.now() - probe.start, frameSamples: probe.frames.length,
      frameMeasurementValid: probe.frames.length >= 5 && p95 < 250,
      frameP95Ms: percentile(probe.frames), frameMaxMs: probe.frames.length ? Math.max(...probe.frames) : null,
      longTasks: probe.longTasks.length, longestTaskMs: probe.longTasks.length ? Math.max(...probe.longTasks) : 0,
      layoutShift: probe.shifts.reduce((sum, entry) => sum + entry.value, 0),
      unexpectedLayoutShift: probe.shifts.filter(entry => !entry.recentInput).reduce((sum, entry) => sum + entry.value, 0) };
  }, name);
}
