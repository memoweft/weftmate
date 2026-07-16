import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import {
  BUILTIN_PETS,
  DEFAULT_PET_ID,
  buildProceduralPet,
  parsePetManifest,
  type PetManifest,
} from './schema.ts';

export type CompanionProactivity = 'quiet' | 'light' | 'companion';

export interface PetView extends PetManifest {
  source: 'builtin' | 'user';
  editable: boolean;
  canDelete: boolean;
  safetyFallback: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface StoredPetRecord {
  createdAt: string;
  updatedAt: string;
  manifest: PetManifest;
}

interface StoredPetFile {
  version: 1;
  pets: StoredPetRecord[];
  petByPersona: Record<string, string>;
  proactivityByPersona: Record<string, CompanionProactivity>;
}

export type PetStoreErrorCode = 'validation' | 'not_found' | 'storage';

export class PetStoreError extends Error {
  readonly code: PetStoreErrorCode;

  constructor(code: PetStoreErrorCode, message: string) {
    super(message);
    this.name = 'PetStoreError';
    this.code = code;
  }
}

const FILE_KEYS = ['version', 'pets', 'petByPersona', 'proactivityByPersona'];
const REQUIRED_FILE_KEYS = ['version', 'pets'];
const RECORD_KEYS = ['createdAt', 'updatedAt', 'manifest'];
const MAX_USER_PETS = 100;
const PERSONA_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !!value && Number.isFinite(Date.parse(value));
}

function isProactivity(value: unknown): value is CompanionProactivity {
  return value === 'quiet' || value === 'light' || value === 'companion';
}

function cloneManifest(value: PetManifest): PetManifest {
  return { ...value, appearance: { ...value.appearance } };
}

function cloneRecord(value: StoredPetRecord): StoredPetRecord {
  return { ...value, manifest: cloneManifest(value.manifest) };
}

function parseStoredFile(value: unknown, knownBuiltinIds: Set<string>): StoredPetFile {
  if (!plainObject(value)
    || Object.keys(value).some((key) => !FILE_KEYS.includes(key))
    || REQUIRED_FILE_KEYS.some((key) => !(key in value))) {
    throw new Error('宠物 Store 字段不正确');
  }
  if (value.version !== 1 || !Array.isArray(value.pets) || value.pets.length > MAX_USER_PETS) {
    throw new Error('宠物 Store 格式不正确');
  }
  const ids = new Set<string>();
  const pets = value.pets.map((candidate): StoredPetRecord => {
    if (!plainObject(candidate) || !exactKeys(candidate, RECORD_KEYS)) throw new Error('宠物记录字段不正确');
    if (!validIso(candidate.createdAt) || !validIso(candidate.updatedAt)) throw new Error('宠物记录时间不正确');
    const manifest = parsePetManifest(candidate.manifest);
    if (knownBuiltinIds.has(manifest.id) || ids.has(manifest.id)) throw new Error('宠物 id 重复');
    ids.add(manifest.id);
    return { createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, manifest };
  });
  const knownPetIds = new Set([...knownBuiltinIds, ...ids]);
  const rawBindings = value.petByPersona;
  if (rawBindings !== undefined && !plainObject(rawBindings)) throw new Error('人格宠物绑定格式不正确');
  const petByPersona: Record<string, string> = {};
  for (const [personaId, petId] of Object.entries(rawBindings ?? {})) {
    if (!PERSONA_ID_RE.test(personaId) || typeof petId !== 'string') throw new Error('人格宠物绑定格式不正确');
    if (knownPetIds.has(petId)) petByPersona[personaId] = petId;
  }
  const rawProactivity = value.proactivityByPersona;
  if (rawProactivity !== undefined && !plainObject(rawProactivity)) throw new Error('陪伴主动度格式不正确');
  const proactivityByPersona: Record<string, CompanionProactivity> = {};
  for (const [personaId, level] of Object.entries(rawProactivity ?? {})) {
    if (!PERSONA_ID_RE.test(personaId) || !isProactivity(level)) throw new Error('陪伴主动度格式不正确');
    if (level !== 'light') proactivityByPersona[personaId] = level;
  }
  return { version: 1, pets, petByPersona, proactivityByPersona };
}

export class PetStore {
  private readonly filePath: string;
  private readonly builtins: Map<string, PetManifest>;
  private readonly fallbackId: string;
  private pets: StoredPetRecord[] = [];
  private petByPersona = new Map<string, string>();
  private proactivityByPersona = new Map<string, CompanionProactivity>();
  private corruptSourcePending = false;
  private corruptBackupCreated = false;

  constructor(
    filePath: string,
    builtins: readonly PetManifest[] = BUILTIN_PETS,
    fallbackId = DEFAULT_PET_ID,
  ) {
    this.filePath = filePath;
    this.builtins = new Map();
    for (const candidate of builtins) {
      const manifest = parsePetManifest(candidate);
      if (this.builtins.has(manifest.id)) throw new Error(`内置宠物 id 重复：${manifest.id}`);
      this.builtins.set(manifest.id, manifest);
    }
    if (!this.builtins.has(fallbackId)) throw new Error(`缺少安全回退宠物：${fallbackId}`);
    this.fallbackId = fallbackId;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = parseStoredFile(JSON.parse(readFileSync(this.filePath, 'utf8')), new Set(this.builtins.keys()));
      this.pets = parsed.pets.map(cloneRecord);
      this.petByPersona = new Map(Object.entries(parsed.petByPersona));
      this.proactivityByPersona = new Map(Object.entries(parsed.proactivityByPersona));
    } catch {
      this.pets = [];
      this.petByPersona = new Map();
      this.proactivityByPersona = new Map();
      this.corruptSourcePending = true;
    }
  }

  private snapshot(
    pets = this.pets,
    petByPersona = this.petByPersona,
    proactivityByPersona = this.proactivityByPersona,
  ): StoredPetFile {
    return {
      version: 1,
      pets: pets.map(cloneRecord),
      petByPersona: Object.fromEntries(petByPersona),
      proactivityByPersona: Object.fromEntries(proactivityByPersona),
    };
  }

  private write(next: StoredPetFile): void {
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (this.corruptSourcePending && !this.corruptBackupCreated && existsSync(this.filePath)) {
        copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}.bak`);
        this.corruptBackupCreated = true;
      }
      writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, this.filePath);
      this.corruptSourcePending = false;
    } catch {
      try { rmSync(tempPath, { force: true }); } catch { /* 保留原文件 */ }
      throw new PetStoreError('storage', '宠物设置暂时无法保存');
    }
  }

  private userRecord(id: string): StoredPetRecord | undefined {
    return this.pets.find((record) => record.manifest.id === id);
  }

  private viewBuiltin(manifest: PetManifest): PetView {
    return {
      ...cloneManifest(manifest), source: 'builtin', editable: false,
      canDelete: false, safetyFallback: manifest.id === this.fallbackId,
    };
  }

  private viewUser(record: StoredPetRecord): PetView {
    return {
      ...cloneManifest(record.manifest), source: 'user', editable: true,
      canDelete: true, safetyFallback: false, createdAt: record.createdAt, updatedAt: record.updatedAt,
    };
  }

  get(id: string): PetView | null {
    const normalized = id.trim();
    const builtin = this.builtins.get(normalized);
    if (builtin) return this.viewBuiltin(builtin);
    const record = this.userRecord(normalized);
    return record ? this.viewUser(record) : null;
  }

  list(): PetView[] {
    return [
      ...[...this.builtins.values()].map((pet) => this.viewBuiltin(pet)),
      ...this.pets.map((pet) => this.viewUser(pet)),
    ];
  }

  fallback(): PetView {
    return this.viewBuiltin(this.builtins.get(this.fallbackId)!);
  }

  petForPersona(personaId: string): PetView {
    const petId = this.petByPersona.get(personaId.trim());
    return (petId ? this.get(petId) : null) ?? this.fallback();
  }

  bindingForPersona(personaId: string): string {
    return this.petForPersona(personaId).id;
  }

  proactivityForPersona(personaId: string): CompanionProactivity {
    return this.proactivityByPersona.get(personaId.trim()) ?? 'light';
  }

  bindingCount(petId: string): number {
    return [...this.petByPersona.values()].filter((id) => id === petId.trim()).length;
  }

  boundPersonaIds(petId: string): string[] {
    const normalized = petId.trim();
    return [...this.petByPersona.entries()].filter(([, id]) => id === normalized).map(([personaId]) => personaId);
  }

  save(input: {
    id?: string;
    name: unknown;
    description?: unknown;
    shape: unknown;
    primary: unknown;
    accent: unknown;
    feature: unknown;
  }, now = new Date().toISOString()): PetView {
    if (!validIso(now)) throw new PetStoreError('validation', '宠物更新时间无效');
    const requestedId = typeof input.id === 'string' ? input.id.trim() : '';
    if (requestedId && this.builtins.has(requestedId)) throw new PetStoreError('validation', '内置宠物不能直接编辑');
    const previous = requestedId ? this.userRecord(requestedId) : undefined;
    if (requestedId && !previous) throw new PetStoreError('not_found', '没有这个自定义宠物');
    if (!previous && this.pets.length >= MAX_USER_PETS) throw new PetStoreError('validation', `自定义宠物最多 ${MAX_USER_PETS} 个`);
    let manifest: PetManifest;
    try {
      manifest = buildProceduralPet({
        id: previous?.manifest.id ?? `pet:${randomUUID()}`,
        name: input.name, description: input.description ?? '', shape: input.shape,
        primary: input.primary, accent: input.accent, feature: input.feature,
      });
    } catch (error) {
      throw new PetStoreError('validation', error instanceof Error ? error.message : '宠物内容不正确');
    }
    const record: StoredPetRecord = {
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      manifest,
    };
    const nextPets = previous
      ? this.pets.map((item) => item.manifest.id === manifest.id ? record : cloneRecord(item))
      : [...this.pets.map(cloneRecord), record];
    this.write(this.snapshot(nextPets));
    this.pets = nextPets;
    return this.viewUser(record);
  }

  bind(personaId: string, petId: string): PetView {
    const normalizedPersona = personaId.trim();
    if (!PERSONA_ID_RE.test(normalizedPersona)) throw new PetStoreError('validation', '人格 id 格式不正确');
    const pet = this.get(petId.trim());
    if (!pet) throw new PetStoreError('not_found', '没有这个宠物');
    const next = new Map(this.petByPersona);
    if (pet.id === this.fallbackId) next.delete(normalizedPersona); else next.set(normalizedPersona, pet.id);
    this.write(this.snapshot(this.pets, next));
    this.petByPersona = next;
    return pet;
  }

  setProactivity(personaId: string, level: unknown): CompanionProactivity {
    const normalizedPersona = personaId.trim();
    if (!PERSONA_ID_RE.test(normalizedPersona) || !isProactivity(level)) {
      throw new PetStoreError('validation', '陪伴主动度必须是 quiet、light 或 companion');
    }
    const next = new Map(this.proactivityByPersona);
    if (level === 'light') next.delete(normalizedPersona); else next.set(normalizedPersona, level);
    this.write(this.snapshot(this.pets, this.petByPersona, next));
    this.proactivityByPersona = next;
    return level;
  }

  /** Soul 删除只清掉本机绑定/表现偏好，不连带删除可被其它 Soul 复用的 Pet。 */
  removePersona(personaId: string): void {
    const normalized = personaId.trim();
    if (!PERSONA_ID_RE.test(normalized)) throw new PetStoreError('validation', '人格 id 格式不正确');
    if (!this.petByPersona.has(normalized) && !this.proactivityByPersona.has(normalized)) return;
    const bindings = new Map(this.petByPersona); bindings.delete(normalized);
    const proactivity = new Map(this.proactivityByPersona); proactivity.delete(normalized);
    this.write(this.snapshot(this.pets, bindings, proactivity));
    this.petByPersona = bindings;
    this.proactivityByPersona = proactivity;
  }

  remove(id: string): { removedId: string; affectedPersonas: string[] } {
    const normalized = id.trim();
    if (this.builtins.has(normalized)) throw new PetStoreError('validation', '内置宠物不能删除');
    if (!this.userRecord(normalized)) throw new PetStoreError('not_found', '没有这个自定义宠物');
    const affectedPersonas = [...this.petByPersona.entries()].filter(([, petId]) => petId === normalized).map(([personaId]) => personaId);
    const nextPets = this.pets.filter((item) => item.manifest.id !== normalized).map(cloneRecord);
    const nextBindings = new Map(this.petByPersona);
    for (const personaId of affectedPersonas) nextBindings.delete(personaId);
    this.write(this.snapshot(nextPets, nextBindings));
    this.pets = nextPets;
    this.petByPersona = nextBindings;
    return { removedId: normalized, affectedPersonas };
  }
}
