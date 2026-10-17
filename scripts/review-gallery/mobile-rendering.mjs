// Keep the rendering scene's preparation shared with its browser regression.
export async function prepareMobileRendering(page, phase = () => {}) {
  phase('heading-scroll');
  // Programmatic scrolling alone leaves the conversation following the latest
  // message. Use its upward-input handler before moving to older sample content,
  // so a pending content/resize follow cannot pull the lazy diagram out of view.
  await page.locator('#chat-scroll').dispatchEvent('wheel', { deltaY: -1 });
  await page.getByRole('heading', { name: '公式与图表', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('.render-mermaid').first().scrollIntoViewIfNeeded();
  phase('diagram-ready');
  await page.locator('.render-diagram img').waitFor();
}
