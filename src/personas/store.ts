import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { buildPersonaManifest, parsePersonaManifest, type PersonaManifest } from './manifest.ts';

export type { PersonaManifest } from './manifest.ts';

export type PersonaStoreErrorCode = 'validation' | 'not_found' | 'storage';

/** 对外只暴露稳定错误类别和普通文案，不携带底层文件路径或系统错误。 */
export class PersonaStoreError extends Error {
  readonly code: PersonaStoreErrorCode;

  constructor(code: PersonaStoreErrorCode, message: string) {
    super(message);
    this.name = 'PersonaStoreError';
    this.code = code;
  }
}

export interface PersonaView extends PersonaManifest {
  source: 'builtin' | 'user';
  editable: boolean;
  canRename: boolean;
  canDelete: boolean;
  safetyFallback: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PersonaSummary {
  id: string;
  name: string;
  description: string;
  source: PersonaView['source'];
  editable: boolean;
  canRename: boolean;
  canDelete: boolean;
  safetyFallback: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PersonaRemovalResult {
  removedId: string;
  source: PersonaView['source'];
  current: string;
}

interface StoredPersonaRecord {
  createdAt: string;
  updatedAt: string;
  manifest: PersonaManifest;
}

interface StoredPersonaFile {
  version: 1;
  currentPersonaId: string;
  assistantHistoryBoundaryAt: string | null;
  personas: StoredPersonaRecord[];
  builtinNameOverrides: Record<string, string>;
  hiddenBuiltinIds: string[];
}

const FILE_KEYS = ['version', 'currentPersonaId', 'assistantHistoryBoundaryAt', 'personas', 'builtinNameOverrides', 'hiddenBuiltinIds'];
const REQUIRED_FILE_KEYS = ['version', 'currentPersonaId', 'personas'];
const RECORD_KEYS = ['createdAt', 'updatedAt', 'manifest'];
const LEGACY_RECORD_KEYS = ['source', 'createdAt', 'updatedAt', 'manifest'];
const MAX_USER_PERSONAS = 100;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !!value && Number.isFinite(Date.parse(value));
}

function cloneManifest(value: PersonaManifest): PersonaManifest {
  return { ...value };
}

function cloneRecord(value: StoredPersonaRecord): StoredPersonaRecord {
  return { ...value, manifest: cloneManifest(value.manifest) };
}

function parseStoredFile(value: unknown): StoredPersonaFile {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !FILE_KEYS.includes(key))
    || REQUIRED_FILE_KEYS.some((key) => !(key in value))) {
    throw new Error('人格 Store 字段不正确');
  }
  if (value.version !== 1 || typeof value.currentPersonaId !== 'string' || !Array.isArray(value.personas)) {
    throw new Error('人格 Store 格式不正确');
  }
  if (value.personas.length > MAX_USER_PERSONAS) throw new Error('自定义人格数量超限');
  const boundary = value.assistantHistoryBoundaryAt;
  if (boundary !== undefined && boundary !== null && !validIso(boundary)) throw new Error('人格历史边界无效');
  const rawOverrides = value.builtinNameOverrides;
  if (rawOverrides !== undefined && !plainObject(rawOverrides)) throw new Error('内置人格名称覆盖格式不正确');
  const builtinNameOverrides: Record<string, string> = {};
  for (const [id, name] of Object.entries(rawOverrides ?? {})) {
    if (typeof name !== 'string') throw new Error('内置人格名称覆盖格式不正确');
    builtinNameOverrides[id] = name;
  }
  const rawHidden = value.hiddenBuiltinIds;
  if (rawHidden !== undefined && (!Array.isArray(rawHidden) || rawHidden.some((id) => typeof id !== 'string'))) {
    throw new Error('内置人格隐藏记录格式不正确');
  }
  const hiddenBuiltinIds = [...new Set((rawHidden ?? []).map((id) => id.trim()))];
  const ids = new Set<string>();
  const personas = value.personas.map((candidate): StoredPersonaRecord => {
    if (!plainObject(candidate) || (!exactKeys(candidate, RECORD_KEYS) && !exactKeys(candidate, LEGACY_RECORD_KEYS))) {
      throw new Error('人格记录字段不正确');
    }
    if ('source' in candidate && candidate.source !== 'user') throw new Error('人格记录来源不正确');
    if (!validIso(candidate.createdAt) || !validIso(candidate.updatedAt)) throw new Error('人格记录元数据不正确');
    const manifest = parsePersonaManifest(candidate.manifest);
    if (ids.has(manifest.id)) throw new Error('人格 id 重复');
    ids.add(manifest.id);
    return { createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, manifest };
  });
  return {
    version: 1,
    currentPersonaId: value.currentPersonaId.trim(),
    assistantHistoryBoundaryAt: boundary === undefined ? null : boundary,
    personas,
    builtinNameOverrides,
    hiddenBuiltinIds,
  };
}

/**
 * 人格变化后的上下文过滤纯函数：用户原话始终保留；只移除边界及边界前的旧 assistant 回复。
 * 缺时间的旧 assistant 无法证明属于新人格，按边界前处理；边界后的新人格回复继续参与上下文。
 */
export function filterPersonaHistory<T extends { role: 'user' | 'assistant'; ts?: string }>(
  turns: readonly T[],
  boundaryAt: string | null,
): T[] {
  if (!boundaryAt || !validIso(boundaryAt)) return [...turns];
  const boundaryMs = Date.parse(boundaryAt);
  return turns.filter((turn) => turn.role === 'user' || (validIso(turn.ts) && Date.parse(turn.ts) > boundaryMs));
}

/**
 * WeftMate 本地 Persona Store。内置人格只由代码提供，不复制进用户文件；用户文件保存当前选择、
 * 人格变化上下文边界和用户人格。所有修改先原子写盘，再替换进程内状态。
 */
export class PersonaStore {
  private readonly filePath: string;
  private readonly builtins: Map<string, PersonaManifest>;
  private readonly invalidFallbackId: string;
  private currentPersonaId: string;
  private contextBoundaryAt: string | null = null;
  private personas: StoredPersonaRecord[] = [];
  private builtinNameOverrides = new Map<string, string>();
  private hiddenBuiltinIds = new Set<string>();
  private corruptSourcePending = false;
  private corruptBackupCreated = false;

  constructor(filePath: string, builtins: PersonaManifest[], legacyDefaultId: string, invalidFallbackId = 'plain') {
    this.filePath = filePath;
    this.builtins = new Map();
    for (const candidate of builtins) {
      const manifest = parsePersonaManifest(candidate);
      if (this.builtins.has(manifest.id)) throw new Error(`内置人格 id 重复：${manifest.id}`);
      this.builtins.set(manifest.id, manifest);
    }
    if (!this.builtins.has(invalidFallbackId)) throw new Error(`缺少安全回退人格：${invalidFallbackId}`);
    this.invalidFallbackId = invalidFallbackId;
    this.currentPersonaId = this.builtins.has(legacyDefaultId) ? legacyDefaultId : invalidFallbackId;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = parseStoredFile(JSON.parse(readFileSync(this.filePath, 'utf8')));
      const builtinIds = new Set(this.builtins.keys());
      if (parsed.personas.some((record) => builtinIds.has(record.manifest.id))) throw new Error('用户人格与内置 id 冲突');
      const overrides = new Map<string, string>();
      for (const [id, name] of Object.entries(parsed.builtinNameOverrides)) {
        const builtin = this.builtins.get(id);
        if (!builtin) throw new Error('内置人格名称覆盖引用未知 id');
        overrides.set(id, buildPersonaManifest({ ...builtin, name }).name);
      }
      const hidden = new Set<string>();
      for (const id of parsed.hiddenBuiltinIds) {
        if (!this.builtins.has(id)) throw new Error('内置人格隐藏记录引用未知 id');
        if (id === this.invalidFallbackId) throw new Error('安全回退人格不能隐藏');
        hidden.add(id);
      }
      this.personas = parsed.personas.map(cloneRecord);
      this.builtinNameOverrides = overrides;
      this.hiddenBuiltinIds = hidden;
      this.currentPersonaId = this.has(parsed.currentPersonaId) ? parsed.currentPersonaId : this.invalidFallbackId;
      this.contextBoundaryAt = parsed.assistantHistoryBoundaryAt;
    } catch {
      this.personas = [];
      this.builtinNameOverrides = new Map();
      this.hiddenBuiltinIds = new Set();
      this.currentPersonaId = this.invalidFallbackId;
      this.contextBoundaryAt = null;
      this.corruptSourcePending = true;
    }
  }

  private snapshot(
    currentPersonaId = this.currentPersonaId,
    personas = this.personas,
    assistantHistoryBoundaryAt = this.contextBoundaryAt,
    builtinNameOverrides = this.builtinNameOverrides,
    hiddenBuiltinIds = this.hiddenBuiltinIds,
  ): StoredPersonaFile {
    return {
      version: 1,
      currentPersonaId,
      assistantHistoryBoundaryAt,
      personas: personas.map(cloneRecord),
      builtinNameOverrides: Object.fromEntries(builtinNameOverrides),
      hiddenBuiltinIds: [...hiddenBuiltinIds],
    };
  }

  private write(next: StoredPersonaFile): void {
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (this.corruptSourcePending && !this.corruptBackupCreated && existsSync(this.filePath)) {
        const backup = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}.bak`;
        copyFileSync(this.filePath, backup);
        this.corruptBackupCreated = true;
      }
      writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, this.filePath);
      this.corruptSourcePending = false;
    } catch {
      try { rmSync(tempPath, { force: true }); } catch { /* 原文件或损坏副本保持不动 */ }
      throw new PersonaStoreError('storage', '人格设置暂时无法保存');
    }
  }

  private userRecord(id: string): StoredPersonaRecord | undefined {
    return this.personas.find((record) => record.manifest.id === id);
  }

  private viewBuiltin(manifest: PersonaManifest): PersonaView {
    const nameOverride = this.builtinNameOverrides.get(manifest.id);
    const runtimeNameNote = nameOverride
      ? `\n\n当前名称是「${nameOverride}」；自称与称呼以这个用户设置的名称为准。`
      : '';
    return {
      ...cloneManifest(manifest),
      ...(nameOverride ? { name: nameOverride, systemPrompt: `${manifest.systemPrompt}${runtimeNameNote}` } : {}),
      source: 'builtin',
      editable: false,
      canRename: true,
      canDelete: manifest.id !== this.invalidFallbackId,
      safetyFallback: manifest.id === this.invalidFallbackId,
    };
  }

  private viewUser(record: StoredPersonaRecord): PersonaView {
    return {
      ...cloneManifest(record.manifest),
      source: 'user',
      editable: true,
      canRename: true,
      canDelete: true,
      safetyFallback: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  has(id: string): boolean {
    return (this.builtins.has(id) && !this.hiddenBuiltinIds.has(id)) || !!this.userRecord(id);
  }

  currentId(): string {
    return this.currentPersonaId;
  }

  assistantHistoryBoundaryAt(): string | null {
    return this.contextBoundaryAt;
  }

  current(): PersonaView {
    return this.get(this.currentPersonaId) ?? this.viewBuiltin(this.builtins.get(this.invalidFallbackId)!);
  }

  get(id: string): PersonaView | null {
    const builtin = this.builtins.get(id);
    if (builtin) return this.hiddenBuiltinIds.has(id) ? null : this.viewBuiltin(builtin);
    const record = this.userRecord(id);
    return record ? this.viewUser(record) : null;
  }

  list(): PersonaView[] {
    return [
      ...[...this.builtins.values()].filter((manifest) => !this.hiddenBuiltinIds.has(manifest.id)).map((manifest) => this.viewBuiltin(manifest)),
      ...this.personas.map((record) => this.viewUser(record)),
    ];
  }

  listSummaries(): PersonaSummary[] {
    return this.list().map(({ id, name, description, source, editable, canRename, canDelete, safetyFallback, createdAt, updatedAt }) => ({
      id, name, description, source, editable, canRename, canDelete, safetyFallback,
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    }));
  }

  setCurrent(id: string, now = new Date().toISOString()): PersonaView {
    const normalized = id.trim();
    const persona = this.get(normalized);
    if (!persona) throw new PersonaStoreError('not_found', '没有这个人格');
    if (!validIso(now)) throw new PersonaStoreError('validation', '人格切换时间无效');
    this.write(this.snapshot(normalized, this.personas, now));
    this.currentPersonaId = normalized;
    this.contextBoundaryAt = now;
    return persona;
  }

  save(input: { id?: string; name: unknown; description: unknown; systemPrompt: unknown }, now = new Date().toISOString()): PersonaView {
    if (!validIso(now)) throw new PersonaStoreError('validation', '人格更新时间无效');
    const requestedId = typeof input.id === 'string' ? input.id.trim() : '';
    if (requestedId && this.builtins.has(requestedId)) throw new PersonaStoreError('validation', '内置人格不能直接编辑');
    const previous = requestedId ? this.userRecord(requestedId) : undefined;
    if (requestedId && !previous) throw new PersonaStoreError('not_found', '没有这个自定义人格');
    if (!previous && this.personas.length >= MAX_USER_PERSONAS) {
      throw new PersonaStoreError('validation', `自定义人格最多 ${MAX_USER_PERSONAS} 个`);
    }
    const id = previous?.manifest.id ?? `persona:${randomUUID()}`;
    let manifest: PersonaManifest;
    try {
      manifest = buildPersonaManifest({
        id,
        name: input.name,
        description: input.description ?? '',
        systemPrompt: input.systemPrompt,
      });
    } catch (error) {
      throw new PersonaStoreError('validation', error instanceof Error ? error.message : '人格内容不正确');
    }
    const record: StoredPersonaRecord = {
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      manifest,
    };
    const nextPersonas = previous
      ? this.personas.map((item) => item.manifest.id === id ? record : cloneRecord(item))
      : [...this.personas.map(cloneRecord), record];
    const editingCurrent = previous?.manifest.id === this.currentPersonaId;
    const nextBoundary = editingCurrent ? now : this.contextBoundaryAt;
    this.write(this.snapshot(this.currentPersonaId, nextPersonas, nextBoundary));
    this.personas = nextPersonas;
    this.contextBoundaryAt = nextBoundary;
    return this.viewUser(record);
  }

  renamePersona(id: string, name: unknown, now = new Date().toISOString()): PersonaView {
    if (!validIso(now)) throw new PersonaStoreError('validation', '人格更新时间无效');
    const normalized = id.trim();
    const builtin = this.builtins.get(normalized);
    if (builtin) {
      if (this.hiddenBuiltinIds.has(normalized)) throw new PersonaStoreError('not_found', '没有这个人格');
      let validatedName: string;
      try {
        validatedName = buildPersonaManifest({ ...builtin, name }).name;
      } catch (error) {
        throw new PersonaStoreError('validation', error instanceof Error ? error.message : '人格名称不正确');
      }
      const currentName = this.builtinNameOverrides.get(normalized) ?? builtin.name;
      const nextOverrides = new Map(this.builtinNameOverrides);
      if (validatedName === builtin.name) nextOverrides.delete(normalized);
      else nextOverrides.set(normalized, validatedName);
      const nextBoundary = normalized === this.currentPersonaId && validatedName !== currentName ? now : this.contextBoundaryAt;
      this.write(this.snapshot(this.currentPersonaId, this.personas, nextBoundary, nextOverrides, this.hiddenBuiltinIds));
      this.builtinNameOverrides = nextOverrides;
      this.contextBoundaryAt = nextBoundary;
      return this.viewBuiltin(builtin);
    }

    const previous = this.userRecord(normalized);
    if (!previous) throw new PersonaStoreError('not_found', '没有这个人格');
    let manifest: PersonaManifest;
    try {
      manifest = buildPersonaManifest({ ...previous.manifest, name });
    } catch (error) {
      throw new PersonaStoreError('validation', error instanceof Error ? error.message : '人格名称不正确');
    }
    const record = { ...cloneRecord(previous), updatedAt: now, manifest };
    const nextPersonas = this.personas.map((item) => item.manifest.id === normalized ? record : cloneRecord(item));
    const nextBoundary = normalized === this.currentPersonaId && manifest.name !== previous.manifest.name ? now : this.contextBoundaryAt;
    this.write(this.snapshot(this.currentPersonaId, nextPersonas, nextBoundary));
    this.personas = nextPersonas;
    this.contextBoundaryAt = nextBoundary;
    return this.viewUser(record);
  }

  removePersona(id: string, now = new Date().toISOString()): PersonaRemovalResult {
    if (!validIso(now)) throw new PersonaStoreError('validation', '人格删除时间无效');
    const normalized = id.trim();
    if (normalized === this.invalidFallbackId) throw new PersonaStoreError('validation', '普通助手是系统安全兜底，不能删除');

    const builtin = this.builtins.get(normalized);
    const record = this.userRecord(normalized);
    if ((!builtin || this.hiddenBuiltinIds.has(normalized)) && !record) throw new PersonaStoreError('not_found', '没有这个人格');

    const removingCurrent = normalized === this.currentPersonaId;
    const nextCurrent = removingCurrent ? this.invalidFallbackId : this.currentPersonaId;
    const nextBoundary = removingCurrent ? now : this.contextBoundaryAt;
    if (builtin) {
      const nextHidden = new Set(this.hiddenBuiltinIds);
      nextHidden.add(normalized);
      this.write(this.snapshot(nextCurrent, this.personas, nextBoundary, this.builtinNameOverrides, nextHidden));
      this.hiddenBuiltinIds = nextHidden;
    } else {
      const nextPersonas = this.personas.filter((item) => item.manifest.id !== normalized).map(cloneRecord);
      this.write(this.snapshot(nextCurrent, nextPersonas, nextBoundary));
      this.personas = nextPersonas;
    }
    this.currentPersonaId = nextCurrent;
    this.contextBoundaryAt = nextBoundary;
    return { removedId: normalized, source: builtin ? 'builtin' : 'user', current: nextCurrent };
  }
}
