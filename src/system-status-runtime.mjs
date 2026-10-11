import { buildSystemStatus, calculatePerformanceMetrics, repairSystemComponent, buildDiagnosticBundle, diagnosticBundlePreview } from './system-diagnostics.mjs';

/** The existing component owners retain their lifecycle; this only joins their facts. */
export function createSystemStatusManager({ readHost, readMemory, readModel, readRelay, readQueue = () => undefined, repairs,
  diagnostics, metrics, versions }) {
  async function status(ownerId) {
    const read = (provider, fallback) => Promise.resolve().then(() => provider(ownerId)).catch(() => fallback);
    const [host, memory, model, relay] = await Promise.all([
      read(readHost, { state: 'unavailable' }), read(readMemory, { state: 'unavailable' }),
      read(readModel, { state: 'unavailable' }), read(readRelay, { state: 'offline' }),
    ]);
    const value = {
      host: { version: null, lastError: null, canRestart: true, ...host },
      memory: { version: null, lastError: memory?.lastFailureCode ?? memory?.reasonCode ?? null, canRestart: memory?.state !== 'disabled', ...memory },
      model: { version: null, contextWindow: null, slots: null, currentModelId: null, lastSwitch: null, lastError: null, canRestart: true, ...model },
      relay, runRecord: diagnostics.status(),
    };
    return { ...value, queue: readQueue(), ...buildSystemStatus(value), metrics: calculatePerformanceMetrics(metrics()),
      diagnosticPreview: diagnosticBundlePreview() };
  }
  return { status,
    async restart(id, ownerId) {
      try {
        await repairSystemComponent(id, Object.fromEntries(Object.entries(repairs).map(([key, repair]) =>
          [key, () => repair(ownerId)])));
        diagnostics.write?.('component.recovery', { phase: id, status: 'completed', action: 'restart' });
      } catch (error) {
        diagnostics.write?.('component.recovery', { phase: id, status: 'failed', action: 'restart' });
        throw error;
      }
    },
    async export(ownerId) {
      const value = await status(ownerId);
      return buildDiagnosticBundle({ records: diagnostics.records(), summary: value.runRecord.summary,
        components: value.components, performance: value.metrics, versions: { ...versions(), memoryVersion: value.memory?.version }, generatedAt: new Date().toISOString() });
    },
  };
}
