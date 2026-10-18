export function restoreDesktopBounds(saved, displays) {
  const bounds = saved?.bounds;
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) ||
      bounds.width < 760 || bounds.height < 520) return { width: 1200, height: 800 };
  const display = displays.find(({ workArea: area }) => bounds.x + bounds.width > area.x &&
    bounds.y + bounds.height > area.y && bounds.x < area.x + area.width && bounds.y < area.y + area.height);
  if (!display) return { width: 1200, height: 800 };
  const area = display.workArea;
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}

export function physicalDesktopBounds(raw, current, target, scale, toDip, toScreen) {
  const widget = toDip(raw);
  const desired = { x: target.x - (current.x - widget.x), y: target.y - (current.y - widget.y),
    width: target.width + widget.width - current.width, height: target.height + widget.height - current.height };
  const result = toScreen(desired);
  // Chromium rounds the origin, but encloses the size using the physical origin
  // and float32 scale. Invert its actual converter, including that edge phase.
  const radius = Math.ceil(2 * scale);
  for (const key of ['x', 'y', 'width', 'height']) {
    let low = result[key] - radius, high = result[key] + radius;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (toDip({ ...result, [key]: middle })[key] < desired[key]) low = middle + 1;
      else high = middle;
    }
    result[key] = low;
  }
  const converted = toDip(result);
  if (Object.keys(desired).some(key => converted[key] !== desired[key])) throw new Error('WINDOW_BOUNDS_UNREPRESENTABLE');
  return result;
}

