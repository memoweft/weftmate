export const PET_SHAPES = ['orbit', 'sprout', 'wisp'] as const;
export const PET_FEATURES = ['thread', 'leaf', 'halo', 'ears'] as const;

/** hatch-pet / Codex Pet v2 的未来动画资产契约；当前内置 provider 只产程序化外观，不冒充动画图集。 */
export const PET_SPRITE_V2_CONTRACT = Object.freeze({
  spriteVersionNumber: 2,
  atlasWidth: 1536,
  atlasHeight: 2288,
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208,
  standardAnimationRows: 9,
  lookDirections: 16,
});

export type PetShape = typeof PET_SHAPES[number];
export type PetFeature = typeof PET_FEATURES[number];

export interface ProceduralPetAppearance {
  kind: 'procedural';
  shape: PetShape;
  primary: string;
  accent: string;
  feature: PetFeature;
}

export interface PetManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  appearance: ProceduralPetAppearance;
}

const MANIFEST_KEYS = ['schemaVersion', 'id', 'name', 'description', 'appearance'];
const APPEARANCE_KEYS = ['kind', 'shape', 'primary', 'accent', 'feature'];
const ID_RE = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedText(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label}不能为空`);
  if (normalized.length > max) throw new Error(`${label}不能超过 ${max} 个字`);
  if (UNSAFE_CONTROL_RE.test(normalized)) throw new Error(`${label}包含不支持的控制字符`);
  return normalized;
}

function parseAppearance(value: unknown): ProceduralPetAppearance {
  if (!plainObject(value) || !exactKeys(value, APPEARANCE_KEYS)) throw new Error('宠物外观字段不正确');
  if (value.kind !== 'procedural') throw new Error('不支持的宠物外观类型');
  if (typeof value.shape !== 'string' || !PET_SHAPES.includes(value.shape as PetShape)) throw new Error('不支持的宠物造型');
  if (typeof value.feature !== 'string' || !PET_FEATURES.includes(value.feature as PetFeature)) throw new Error('不支持的宠物特征');
  if (typeof value.primary !== 'string' || !COLOR_RE.test(value.primary)) throw new Error('宠物主色格式不正确');
  if (typeof value.accent !== 'string' || !COLOR_RE.test(value.accent)) throw new Error('宠物点缀色格式不正确');
  return {
    kind: 'procedural',
    shape: value.shape as PetShape,
    primary: value.primary.toLowerCase(),
    accent: value.accent.toLowerCase(),
    feature: value.feature as PetFeature,
  };
}

export function parsePetManifest(value: unknown): PetManifest {
  if (!plainObject(value) || !exactKeys(value, MANIFEST_KEYS)) throw new Error('宠物字段不正确');
  if (value.schemaVersion !== 1) throw new Error('不支持的宠物版本');
  const id = boundedText(value.id, '宠物 id', 120, true);
  if (!ID_RE.test(id)) throw new Error('宠物 id 格式不正确');
  return {
    schemaVersion: 1,
    id,
    name: boundedText(value.name, '宠物名称', 80, true),
    description: boundedText(value.description, '宠物简介', 300, false),
    appearance: parseAppearance(value.appearance),
  };
}

export function buildProceduralPet(input: {
  id: unknown;
  name: unknown;
  description?: unknown;
  shape: unknown;
  primary: unknown;
  accent: unknown;
  feature: unknown;
}): PetManifest {
  return parsePetManifest({
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: input.description ?? '',
    appearance: {
      kind: 'procedural',
      shape: input.shape,
      primary: input.primary,
      accent: input.accent,
      feature: input.feature,
    },
  });
}

export const BUILTIN_PETS: readonly PetManifest[] = Object.freeze([
  buildProceduralPet({
    id: 'weft-orbit', name: '织光', description: '安静绕着你的小小织光。',
    shape: 'orbit', primary: '#c46f8b', accent: '#f1b3c5', feature: 'thread',
  }),
  buildProceduralPet({
    id: 'weft-sprout', name: '芽芽', description: '慢慢长大，也陪想法慢慢成形。',
    shape: 'sprout', primary: '#6da47a', accent: '#b8d98d', feature: 'leaf',
  }),
  buildProceduralPet({
    id: 'weft-wisp', name: '微光', description: '轻巧、好奇，喜欢在桌边守候。',
    shape: 'wisp', primary: '#7295d1', accent: '#b8d5ff', feature: 'halo',
  }),
]);

export const DEFAULT_PET_ID = 'weft-orbit';
