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

/** 自由活动开启后以低频随机间隔产生生活感；人格主动度只调节节奏，不决定权限。
 *  漂移修复后节奏放缓（owner：宠物不该一刻不停到处漂）：常伴 30–60s、轻伴 60–120s。 */
export function petRoamDelayMs(level: PetPresenceLevel, random = Math.random): number | null {
  const [min, max] = level === 'quiet' ? [2 * 60_000, 4 * 60_000]
    : level === 'companion' ? [30_000, 60_000] : [60_000, 120_000];
  return min + Math.round(random() * (max - min));
}

/** 鼠标经过时不再避让（owner 拍板 2026-08-16）：宠物是屏幕上自在溜达的搭子，
 *  靠近只注视，不逃跑。避让逻辑整体退役。 */

/** 角色在窗口内的视觉矩形（星瑶 96×104，petWrap 104×116 居中于 132×132 透明窗口）。
 *  贴边计算以它为准——透明窗口留白不再让角色悬空离边。 */
export const PET_CHAR_RECT = { x: 14, y: 8, width: 96, height: 104 };

/** 边缘半隐藏（owner 拍板 2026-08-16，参考 Shimeji/DesktopMate 贴边行为）：
 *  以【角色矩形】为基准贴边——角色恰好触边并可按 ratio 挂出屏幕（默认 55% 角色出屏），
 *  像从屏幕边缘探出头；距边超过 44px 的位置原样返回。 */
export function tuckPetBounds(bounds: DesktopRect, workArea: DesktopRect, ratio = 0.55): DesktopRect {
  if (!finiteRect(bounds) || !finiteRect(workArea)) throw new Error('桌面宠物边缘吸附范围无效');
  const margin = 44;
  const hang = Math.min(0.8, Math.max(0.3, ratio));
  const charX = bounds.x + PET_CHAR_RECT.x;
  const charY = bounds.y + PET_CHAR_RECT.y;
  let x = bounds.x;
  let y = bounds.y;
  if (charX < workArea.x + margin) x = workArea.x - PET_CHAR_RECT.x - Math.round(PET_CHAR_RECT.width * hang);
  else if (charX + PET_CHAR_RECT.width > workArea.x + workArea.width - margin) {
    x = workArea.x + workArea.width - PET_CHAR_RECT.x - Math.round(PET_CHAR_RECT.width * (1 - hang));
  }
  if (charY < workArea.y + margin) y = workArea.y - PET_CHAR_RECT.y - Math.round(PET_CHAR_RECT.height * hang);
  else if (charY + PET_CHAR_RECT.height > workArea.y + workArea.height - margin) {
    y = workArea.y + workArea.height - PET_CHAR_RECT.y - Math.round(PET_CHAR_RECT.height * (1 - hang));
  }
  return { ...bounds, x, y };
}

/**
 * Shimeji 式游走目标（owner 拍板 2026-08-16，参考别的桌宠）：
 *  60% 沿屏幕底部「地板」条带走（贴底边生活）、25% 逛左右边缘竖条（从边缘探头）、15% 全域随意。
 *  目标始终在当前屏幕内（clamp 到 workArea）；贴边半隐藏由 tuckPetBounds 随后处理。
 */
export function pickPetRoamTargetBiased(bounds: DesktopRect, workArea: DesktopRect, random = Math.random): DesktopRect {
  if (!finiteRect(bounds) || !finiteRect(workArea)) throw new Error('桌面宠物移动范围无效');
  const margin = 10;
  const pick = (area: DesktopRect): DesktopRect => {
    const x = area.x + margin + Math.round(random() * Math.max(0, area.width - bounds.width - margin * 2));
    const y = area.y + margin + Math.round(random() * Math.max(0, area.height - bounds.height - margin * 2));
    return clampPetBounds({ ...bounds, x, y }, [workArea]);
  };
  const roll = random();
  if (roll < 0.6) {
    const bandH = Math.max(bounds.height + margin * 2, Math.round(workArea.height * 0.26));
    return pick({ x: workArea.x, y: workArea.y + workArea.height - bandH, width: workArea.width, height: bandH });
  }
  if (roll < 0.85) {
    const sideW = Math.max(bounds.width + margin * 2, Math.round(workArea.width * 0.3));
    const left = random() < 0.5;
    return pick({ x: left ? workArea.x : workArea.x + workArea.width - sideW, y: workArea.y, width: sideW, height: workArea.height });
  }
  return pickPetRoamTarget(bounds, workArea, random);
}

/** 把工作区四边各放宽 pad（游走夹取时允许半隐藏出屏的容差空间）。 */
export function extendedWorkAreas(workAreas: readonly DesktopRect[], pad: DesktopRect): DesktopRect[] {
  return workAreas.map((area) => ({
    x: area.x - pad.width,
    y: area.y - pad.height,
    width: area.width + pad.width * 2,
    height: area.height + pad.height * 2,
  }));
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
