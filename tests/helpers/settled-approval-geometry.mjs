// Run in the page. Wait for scrolling/layout to settle, then measure once.
// Stability is independent of validity: a stationary covered/offscreen action
// still fails the caller's unchanged geometry and hit-test assertions.
export async function settledApprovalGeometry(node) {
  const measure = () => {
    const box = node.getBoundingClientRect(), scroll = node.closest('#chat-scroll').getBoundingClientRect(),
      composer = document.getElementById('message-form').getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { top: box.top, bottom: box.bottom, height: box.height, scrollTop: scroll.top,
      scrollBottom: scroll.bottom, composerTop: composer.top, uncovered: hit === node || node.contains(hit) };
  };
  let previous, stable = 0, geometry;
  while (stable < 2) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    geometry = measure();
    const current = JSON.stringify(geometry);
    stable = current === previous ? stable + 1 : 0; previous = current;
  }
  return geometry;
}
