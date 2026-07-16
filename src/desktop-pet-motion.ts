export interface DesktopRect { x: number; y: number; width: number; height: number }
export interface DesktopPoint { x: number; y: number }
export type PetPresenceLevel = 'quiet' | 'light' | 'companion';

function finiteRect(value: DesktopRect): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0;
}

function overlapArea(left: DesktopRect, right: DesktopRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

export function petRectsOverlap(left: DesktopRect, right: DesktopRect, padding = 0): boolean {
  return left.x < right.x + right.width + padding
    && left.x + left.width > right.x - padding
    && left.y < right.y + right.height + padding
    && left.y + left.height > right.y - padding;
}

export function distanceFromPointToRect(point: DesktopPoint, rect: DesktopRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function centerDistanceSquared(left: DesktopRect, right: DesktopRect): number {
  const dx = left.x + left.width / 2 - (right.x + right.width / 2);
  const dy = left.y + left.height / 2 - (right.y + right.height / 2);
  return dx * dx + dy * dy;
}

/** 优先保留宠物当前覆盖最多的显示器；完全离屏时才选中心点最近的显示器。 */
export function choosePetWorkArea(bounds: DesktopRect, workAreas: readonly DesktopRect[]): DesktopRect {
  if (!finiteRect(bounds) || !workAreas.length || workAreas.some((area) => !finiteRect(area))) throw new Error('桌面宠物屏幕范围无效');
  return [...workAreas].sort((left, right) => {
    const overlap = overlapArea(bounds, right) - overlapArea(bounds, left);
    return overlap || centerDistanceSquared(bounds, left) - centerDistanceSquared(bounds, right);
  })[0];
}

/** 宠物窗口必须完整留在某块 workArea 内，任务栏、负坐标多屏和上下错位屏幕都适用。 */
export function clampPetBounds(bounds: DesktopRect, workAreas: readonly DesktopRect[]): DesktopRect {
  const area = choosePetWorkArea(bounds, workAreas);
  const width = Math.min(Math.round(bounds.width), Math.round(area.width));
  const height = Math.min(Math.round(bounds.height), Math.round(area.height));
  return {
    x: Math.min(Math.max(Math.round(bounds.x), Math.round(area.x)), Math.round(area.x + area.width - width)),
    y: Math.min(Math.max(Math.round(bounds.y), Math.round(area.y)), Math.round(area.y + area.height - height)),
    width,
    height,
  };
}

export function samePetBounds(left: DesktopRect, right: DesktopRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

/** 在当前屏幕内挑一个明显但不突兀的目标；不自动跨屏，也不把宠物贴到任务栏外。 */
export function pickPetRoamTarget(bounds: DesktopRect, workArea: DesktopRect, random = Math.random): DesktopRect {
  if (!finiteRect(bounds) || !finiteRect(workArea)) throw new Error('桌面宠物移动范围无效');
  const dx = (random() < .5 ? -1 : 1) * (96 + Math.round(random() * 264));
  const dy = (random() < .5 ? -1 : 1) * (44 + Math.round(random() * 176));
  return clampPetBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, [workArea]);
}

/** 自由活动开启后以低频随机间隔产生生活感；人格主动度只调节节奏，不决定权限。 */
export function petRoamDelayMs(level: PetPresenceLevel, random = Math.random): number | null {
  const [min, max] = level === 'quiet' ? [2 * 60_000, 4 * 60_000]
    : level === 'companion' ? [20_000, 45_000] : [45_000, 90_000];
  return min + Math.round(random() * (max - min));
}

/** 鼠标挡在宠物附近时，选择离鼠标更远、又不盖住排除区域的位置。 */
export function pickPetAvoidTarget(
  bounds: DesktopRect,
  cursor: DesktopPoint,
  workArea: DesktopRect,
  exclusions: readonly DesktopRect[] = [],
): DesktopRect {
  if (!finiteRect(bounds) || !finiteRect(workArea) || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    throw new Error('桌面宠物避让范围无效');
  }
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let dx = center.x - cursor.x, dy = center.y - cursor.y;
  if (Math.abs(dx) + Math.abs(dy) < 1) { dx = center.x < workArea.x + workArea.width / 2 ? -1 : 1; dy = -0.35; }
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length;
  const vectors = [
    [ux, uy], [ux - uy * .55, uy + ux * .55], [ux + uy * .55, uy - ux * .55],
    [-uy, ux], [uy, -ux],
  ];
  const candidates = vectors.map(([vx, vy], index) => clampPetBounds({
    ...bounds,
    x: bounds.x + Math.round(vx * (index < 3 ? 150 : 105)),
    y: bounds.y + Math.round(vy * (index < 3 ? 150 : 105)),
  }, [workArea]));
  const safe = candidates.filter((candidate) => exclusions.every((rect) => !petRectsOverlap(candidate, rect, 8)));
  return (safe.length ? safe : candidates).sort((left, right) =>
    distanceFromPointToRect(cursor, right) - distanceFromPointToRect(cursor, left))[0] || bounds;
}

/** 把宠物停在窗口外侧；四周都没有完整空间（例如窗口最大化）时返回 null。 */
export function pickPetDockTarget(
  anchor: DesktopRect,
  petSize: Pick<DesktopRect, 'width' | 'height'>,
  workAreas: readonly DesktopRect[],
  gap = 16,
): DesktopRect | null {
  if (!finiteRect(anchor) || !Number.isFinite(petSize.width) || !Number.isFinite(petSize.height)
    || petSize.width <= 0 || petSize.height <= 0) throw new Error('桌面宠物停靠范围无效');
  const area = choosePetWorkArea(anchor, workAreas);
  const y = Math.min(Math.max(anchor.y + anchor.height - petSize.height - 28, area.y), area.y + area.height - petSize.height);
  const x = Math.min(Math.max(anchor.x + anchor.width - petSize.width - 28, area.x), area.x + area.width - petSize.width);
  const candidates: DesktopRect[] = [
    { x: anchor.x + anchor.width + gap, y, ...petSize },
    { x: anchor.x - petSize.width - gap, y, ...petSize },
    { x, y: anchor.y + anchor.height + gap, ...petSize },
    { x, y: anchor.y - petSize.height - gap, ...petSize },
  ];
  return candidates.find((candidate) => candidate.x >= area.x && candidate.y >= area.y
    && candidate.x + candidate.width <= area.x + area.width
    && candidate.y + candidate.height <= area.y + area.height
    && !petRectsOverlap(candidate, anchor)) || null;
}
