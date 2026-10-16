// Runs once in the existing page after prepare has already failed. No waits,
// requests, observers, text/HTML, or page/resource URL reads are performed here.
export function readRenderingSnapshot({ resourceKeys }) {
  const geometry = element => {
    if (!element) return { rect: { x: 0, y: 0, width: 0, height: 0 }, cssVisible: false, intersectsClip: false };
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    }
    const cssVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && box.width > 0 && box.height > 0;
    return { rect: { x: box.x, y: box.y, width: box.width, height: box.height }, cssVisible,
      intersectsClip: cssVisible && bottom > top && right > left && box.bottom > top && box.top < bottom && box.right > left && box.left < right };
  };
  const blocks = document.querySelectorAll('.render-mermaid');
  const block = index => {
    const element = blocks[index], fixed = { slot: index + 1, expected: index === 0 ? 'valid' : 'invalid' };
    if (!element) return { ...fixed, state: 'missing' };
    const view = element.querySelector('.render-diagram'), images = element.querySelectorAll('.render-diagram img'), image = images[0];
    const fallback = element.classList.contains('diagram-failed'), statusNode = !!element.querySelector('.render-status');
    const frame = geometry(element), picture = geometry(image);
    return { ...fixed, state: fallback ? 'fallback' : images.length ? 'image' : statusNode ? 'status' : 'empty',
      fallback, sourceMode: element.classList.contains('is-source'), viewPresent: !!view, viewHidden: !!view?.hidden, statusNode,
      blockRect: frame.rect, cssVisible: frame.cssVisible, intersectsClip: frame.intersectsClip,
      imageCount: images.length, imagePresent: !!image, imageComplete: !!image?.complete,
      naturalWidth: image?.naturalWidth ?? 0, naturalHeight: image?.naturalHeight ?? 0,
      imageRect: picture.rect, imageCssVisible: picture.cssVisible, imageIntersectsClip: picture.intersectsClip };
  };
  const resource = key => {
    const fixed = { entryCount: 0, durationMs: 0, responseEndMs: 0, statusBucket: 'unknown' };
    if (!key || typeof performance !== 'object' || typeof performance.getEntriesByName !== 'function') return { state: 'unavailable', ...fixed };
    const entries = performance.getEntriesByName(key, 'resource'), last = entries[entries.length - 1];
    if (!last) return { state: 'not-recorded', ...fixed };
    const status = last.responseStatus;
    return { state: 'recorded', entryCount: entries.length, durationMs: last.duration, responseEndMs: last.responseEnd,
      statusBucket: Number.isInteger(status) && status >= 200 && status < 600 ? `${Math.floor(status / 100)}xx` : 'unknown' };
  };
  return { totalBlocks: blocks.length, totalImages: document.querySelectorAll('.render-diagram img').length,
    blocksTruncated: blocks.length > 2, blocks: [block(0), block(1)],
    resources: { module: resource(resourceKeys[0]), library: resource(resourceKeys[1]) } };
}

export function renderingFailureSampler(page, getKnownBase) {
  return () => {
    if (page.isClosed()) return undefined;
    const base = getKnownBase();
    const resourceKeys = base ? ['mermaid.js', 'mermaid.tiny.js'].map(name => new URL(`/render-vendor/${name}`, base).href) : [];
    return page.evaluate(readRenderingSnapshot, { resourceKeys });
  };
}

const count = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const boolean = value => typeof value === 'boolean';
const oneOf = values => value => values.includes(value);
function pick(source, rules) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error();
  const result = {};
  for (const [key, valid] of Object.entries(rules)) {
    const value = source[key];
    if (!valid(value)) throw Error();
    result[key] = value;
  }
  return result;
}
const rect = source => pick(source, { x: finite, y: finite, width: nonnegative, height: nonnegative });
export function sanitizeRenderingSnapshot(source) {
  try {
    const result = pick(source, { totalBlocks: count, totalImages: count, blocksTruncated: boolean });
    if (!Array.isArray(source.blocks) || source.blocks.length !== 2) return undefined;
    result.blocks = [0, 1].map(index => {
      const block = source.blocks[index];
      const fixed = pick(block, { slot: value => value === index + 1, expected: value => value === (index === 0 ? 'valid' : 'invalid'),
        state: oneOf(['missing', 'fallback', 'image', 'status', 'empty']) });
      if (fixed.state === 'missing') return fixed;
      const details = pick(block, { fallback: boolean, sourceMode: boolean, viewPresent: boolean, viewHidden: boolean, statusNode: boolean,
        cssVisible: boolean, intersectsClip: boolean, imageCount: count, imagePresent: boolean, imageComplete: boolean,
        naturalWidth: count, naturalHeight: count, imageCssVisible: boolean, imageIntersectsClip: boolean });
      return { ...fixed, ...details, blockRect: rect(block.blockRect), imageRect: rect(block.imageRect),
        loaded: details.imagePresent && details.imageComplete && details.naturalWidth > 0 && details.naturalHeight > 0 };
    });
    const resource = value => pick(value, { state: oneOf(['recorded', 'not-recorded', 'unavailable']), entryCount: count,
      durationMs: nonnegative, responseEndMs: nonnegative, statusBucket: oneOf(['2xx', '3xx', '4xx', '5xx', 'unknown']) });
    result.resources = { module: resource(source.resources.module), library: resource(source.resources.library) };
    return result;
  } catch { return undefined; }
}

// This diagnostic allowance is AFTER the unchanged failed prepare decision.
// A deadline abandons the result, not the underlying page.evaluate protocol call.
export function sampleFailureSnapshot(sample) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => finish({ sampleStatus: 'timeout' }), 250);
    Promise.resolve().then(sample).then(value => {
      if (settled) return;
      if (value === undefined) return finish({ sampleStatus: 'unavailable' });
      const snapshot = sanitizeRenderingSnapshot(value);
      finish(snapshot ? { sampleStatus: 'ok', renderingSnapshot: snapshot } : { sampleStatus: 'invalid' });
    }, () => finish({ sampleStatus: 'error' }));
  });
}
