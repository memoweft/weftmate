import { sanitizeRenderingSnapshot } from './rendering-snapshot.mjs';

const phases = new Set(['prepare', 'fixture-create', 'navigate', 'login-ready', 'session-list',
  'drawer-open', 'session-select', 'heading-scroll', 'diagram-ready']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Observe the actual scene page without retaining event arguments or error text.
export function observePageFailures(page) {
  let pageErrors = 0, pageCrashes = 0;
  const error = () => { pageErrors = Math.min(pageErrors + 1, Number.MAX_SAFE_INTEGER); };
  const crash = () => { pageCrashes = Math.min(pageCrashes + 1, Number.MAX_SAFE_INTEGER); };
  page.on('pageerror', error);
  page.on('crash', crash);
  return {
    snapshot: () => ({ pageErrors, pageCrashes }),
    dispose() { page.off('pageerror', error); page.off('crash', crash); },
  };
}

export function sceneFailureDetails(record) {
  const details = { phase: phases.has(record.phase) ? record.phase : 'prepare' };
  if (record.pageErrors !== undefined) details.pageErrors = count(record.pageErrors);
  if (record.pageCrashes !== undefined) details.pageCrashes = count(record.pageCrashes);
  if (record.sampleStatus !== undefined) {
    details.sampleStatus = ['ok', 'timeout', 'error', 'unavailable', 'invalid'].includes(record.sampleStatus) ? record.sampleStatus : 'invalid';
    if (details.sampleStatus === 'ok') {
      const snapshot = sanitizeRenderingSnapshot(record.renderingSnapshot);
      if (snapshot) details.renderingSnapshot = snapshot;
      else details.sampleStatus = 'invalid';
    }
  }
  return details;
}

export function sceneFailureSummary(record) {
  return { scene: record.scene, theme: record.theme, reason: record.reason, ...sceneFailureDetails(record) };
}

export function publishSceneFailure(record, publish = message => console.log(message)) {
  const details = sceneFailureDetails(record);
  const counts = details.pageErrors === undefined ? '' : ` pageErrors=${details.pageErrors} pageCrashes=${details.pageCrashes}`;
  const sample = details.sampleStatus === undefined ? '' : ` sampleStatus=${details.sampleStatus}${details.renderingSnapshot ? ` renderingSnapshot=${JSON.stringify(details.renderingSnapshot)}` : ''}`;
  const message = `${record.platform}/${record.scene}/${record.theme}: 截图失败：${record.reason} phase=${details.phase}${counts}${sample}`;
  // Publication is diagnostic only: do not await it or let it replace the outcome.
  try { Promise.resolve(publish(message)).catch(() => {}); } catch {}
}
