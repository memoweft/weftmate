// Keep the rendering scene's preparation shared with its browser regression.
export async function prepareMobileRendering(page, phase = () => {}) {
  phase('heading-scroll');
  const heading = page.getByRole('heading', { name: '公式与图表', exact: true });
  await heading.waitFor();
  // Move off the bottom and cancel following in the same page task. Otherwise
  // an already queued scroll event can re-pin while still waiting at the bottom.
  await heading.evaluate(node => {
    node.scrollIntoView({ block: 'center', behavior: 'instant' });
    node.closest('#chat-scroll').dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
  });
  await page.locator('.render-mermaid').first().scrollIntoViewIfNeeded();
  phase('diagram-ready');
  await page.locator('.render-diagram img').waitFor();
}
