/** WeftMate Persona Manifest v1：可分享部分只允许这五个字段。 */
export interface PersonaManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

const MANIFEST_KEYS = ['schemaVersion', 'id', 'name', 'description', 'systemPrompt'] as const;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DANGEROUS_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const LINE_BREAK_OR_TAB_RE = /[\r\n\t]/u;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
}

function boundedText(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  const text = value.trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > max) throw new Error(`${label}太长（最多 ${max} 字）`);
  if (DANGEROUS_CONTROL_RE.test(text)) throw new Error(`${label}含有不支持的控制字符`);
  return text;
}

function personaName(value: unknown): string {
  if (typeof value === 'string' && LINE_BREAK_OR_TAB_RE.test(value)) {
    throw new Error('人格名称只能写一行，不能包含换行或制表符');
  }
  const name = boundedText(value, '人格名称', 80, true);
  return name;
}

/** 严格读取持久 Manifest：多一个字段也拒绝，避免私人数据混入人格记录。 */
export function parsePersonaManifest(value: unknown): PersonaManifest {
  if (!plainObject(value) || !exactKeys(value, MANIFEST_KEYS)) throw new Error('人格 Manifest 字段不正确');
  if (value.schemaVersion !== 1) throw new Error('不支持的人格 Manifest 版本');
  const id = boundedText(value.id, '人格 id', 120, true);
  if (!ID_RE.test(id)) throw new Error('人格 id 格式不正确');
  return {
    schemaVersion: 1,
    id,
    name: personaName(value.name),
    description: boundedText(value.description, '人格描述', 500, false),
    systemPrompt: boundedText(value.systemPrompt, '人格提示词', 8_000, true),
  };
}

/** 创建/编辑入口只接收产品字段，id 由 Store 创建或校验。 */
export function buildPersonaManifest(input: {
  id: string;
  name: unknown;
  description: unknown;
  systemPrompt: unknown;
}): PersonaManifest {
  return parsePersonaManifest({
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
  });
}
