import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ProfileSourceSnapshot {
  content: string;
  contentType: string;
  formedBy: string;
  scope?: string | null;
  validAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProfileOverrideRecord {
  content: string;
  updatedAt: string;
  sourceSnapshot?: ProfileSourceSnapshot;
  independent?: boolean;
  mutedAt?: string | null;
  restoredFromRejection?: boolean;
}

interface RejectionReceipt {
  rejectedAt: string;
}

interface ProfileOverrideFile {
  version: 1;
  overrides: Record<string, ProfileOverrideRecord>;
  rejections: Record<string, RejectionReceipt>;
}

interface SourceCognition {
  id: string;
  content: string;
  contentType?: string;
  formedBy?: string;
  scope?: string | null;
  validAt?: string | null;
  invalidAt?: string | null;
  archivedAt?: string | null;
  mutedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  sources?: unknown[];
}

interface OverlayView {
  overridden: boolean;
  independent?: boolean;
  needsReview?: boolean;
  sourceMissing?: boolean;
  sourceInvalidAt?: string | null;
  sourceArchivedAt?: string | null;
  originalContent?: string;
  overrideUpdatedAt?: string;
  rejectedByUser?: boolean;
  rejectedAt?: string;
  restoredFromRejection?: boolean;
}

const EMPTY_FILE: ProfileOverrideFile = { version: 1, overrides: {}, rejections: {} };

function normalizeSnapshot(value: unknown): ProfileSourceSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.content !== 'string' || !raw.content.trim()) return undefined;
  return {
    content: raw.content.trim(),
    contentType: typeof raw.contentType === 'string' ? raw.contentType : 'fact',
    formedBy: typeof raw.formedBy === 'string' ? raw.formedBy : 'stated',
    ...(typeof raw.scope === 'string' || raw.scope === null ? { scope: raw.scope } : {}),
    ...(typeof raw.validAt === 'string' || raw.validAt === null ? { validAt: raw.validAt } : {}),
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
  };
}

function snapshotFrom(source: SourceCognition): ProfileSourceSnapshot {
  return {
    content: source.content,
    contentType: source.contentType ?? 'fact',
    formedBy: source.formedBy ?? 'stated',
    scope: source.scope ?? null,
    validAt: source.validAt ?? null,
    ...(source.createdAt ? { createdAt: source.createdAt } : {}),
    ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}),
  };
}

function normalizeFile(value: unknown): ProfileOverrideFile {
  if (!value || typeof value !== 'object') return { ...EMPTY_FILE, overrides: {}, rejections: {} };
  const raw = value as Record<string, unknown>;
  const source = raw.overrides && typeof raw.overrides === 'object'
    ? raw.overrides as Record<string, unknown>
    : {};
  const overrides: Record<string, ProfileOverrideRecord> = {};
  for (const [id, candidate] of Object.entries(source)) {
    if (!id || !candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;
    const sourceSnapshot = normalizeSnapshot(record.sourceSnapshot);
    overrides[id] = {
      content,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      ...(sourceSnapshot ? { sourceSnapshot } : {}),
      ...(record.independent === true ? { independent: true } : {}),
      ...(typeof record.mutedAt === 'string' || record.mutedAt === null ? { mutedAt: record.mutedAt } : {}),
      ...(record.restoredFromRejection === true ? { restoredFromRejection: true } : {}),
    };
  }
  const rejectionSource = raw.rejections && typeof raw.rejections === 'object'
    ? raw.rejections as Record<string, unknown>
    : {};
  const rejections: Record<string, RejectionReceipt> = {};
  for (const [id, candidate] of Object.entries(rejectionSource)) {
    if (!id || !candidate || typeof candidate !== 'object') continue;
    const rejectedAt = (candidate as Record<string, unknown>).rejectedAt;
    if (typeof rejectedAt === 'string' && rejectedAt) rejections[id] = { rejectedAt };
  }
  return { version: 1, overrides, rejections };
}

function syntheticCognition(id: string, record: ProfileOverrideRecord, needsReview: boolean): SourceCognition & OverlayView {
  const snapshot = record.sourceSnapshot;
  return {
    id,
    content: record.content,
    contentType: snapshot?.contentType ?? 'fact',
    formedBy: snapshot?.formedBy ?? 'stated',
    scope: snapshot?.scope ?? null,
    validAt: snapshot?.validAt ?? null,
    invalidAt: null,
    archivedAt: null,
    mutedAt: record.independent ? (record.mutedAt ?? null) : null,
    createdAt: snapshot?.createdAt ?? record.updatedAt,
    updatedAt: record.updatedAt,
    sources: [],
    overridden: true,
    independent: record.independent === true,
    needsReview,
    sourceMissing: true,
    originalContent: snapshot?.content,
    overrideUpdatedAt: record.updatedAt,
    restoredFromRejection: record.restoredFromRejection === true,
  };
}

function searchUnits(value: string): Set<string> {
  const normalized = value.trim().toLocaleLowerCase();
  const units = new Set<string>();
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      if (token.length === 1) units.add(token);
      for (let index = 0; index < token.length - 1; index++) units.add(token.slice(index, index + 2));
    } else if (token.length >= 2) {
      units.add(token);
    }
  }
  return units;
}

/** WeftMate 自己的画像文案覆盖层；不修改 MemoWeft cognition/evidence/export。 */
export class ProfileOverrideStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private read(): ProfileOverrideFile {
    try {
      if (!existsSync(this.filePath)) return { ...EMPTY_FILE, overrides: {}, rejections: {} };
      return normalizeFile(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return { ...EMPTY_FILE, overrides: {}, rejections: {} };
    }
  }

  private write(value: ProfileOverrideFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, this.filePath);
    } catch (error) {
      try { rmSync(tempPath, { force: true }); } catch { /* 原文件保持不动 */ }
      throw error;
    }
  }

  hasOverrides(): boolean {
    return Object.keys(this.read().overrides).length > 0;
  }

  set(cognitionId: string, content: string, source?: SourceCognition, now = new Date().toISOString()): ProfileOverrideRecord {
    const id = cognitionId.trim();
    const normalized = content.trim();
    if (!id || !normalized) throw new Error('画像修改缺少条目或内容');
    const file = this.read();
    const previous = file.overrides[id];
    const sourceSnapshot = previous?.sourceSnapshot ?? (source ? snapshotFrom(source) : undefined);
    if (!sourceSnapshot) throw new Error('画像修改缺少底层理解快照');
    const record: ProfileOverrideRecord = {
      content: normalized,
      updatedAt: now,
      sourceSnapshot,
      ...(previous?.independent ? { independent: true, mutedAt: previous.mutedAt ?? null } : {}),
    };
    file.overrides[id] = record;
    delete file.rejections[id];
    this.write(file);
    return record;
  }

  remove(cognitionId: string): boolean {
    const id = cognitionId.trim();
    if (!id) return false;
    const file = this.read();
    if (!file.overrides[id]) return false;
    delete file.overrides[id];
    this.write(file);
    return true;
  }

  /** 原子记录“用户否定”：收据只有 id + 时间，不复制被否定的正文。 */
  markRejected(cognitionId: string, now = new Date().toISOString()): void {
    const id = cognitionId.trim();
    if (!id) throw new Error('否定收据缺少条目 id');
    const file = this.read();
    delete file.overrides[id];
    file.rejections[id] = { rejectedAt: now };
    this.write(file);
  }

  hasRejection(cognitionId: string): boolean {
    return !!this.read().rejections[cognitionId];
  }

  removeRejection(cognitionId: string): boolean {
    const id = cognitionId.trim();
    if (!id) return false;
    const file = this.read();
    if (!file.rejections[id]) return false;
    delete file.rejections[id];
    this.write(file);
    return true;
  }

  /** 反悔不改 MemoWeft 的 invalid 状态；原子消费收据并建立独立产品层画像。 */
  restoreRejected(source: SourceCognition | null, now = new Date().toISOString()): ProfileOverrideRecord | null {
    if (!source) return null;
    const file = this.read();
    if (!file.rejections[source.id]) return null;
    const record: ProfileOverrideRecord = {
      content: source.content,
      updatedAt: now,
      sourceSnapshot: snapshotFrom(source),
      independent: true,
      mutedAt: null,
      restoredFromRejection: true,
    };
    delete file.rejections[source.id];
    file.overrides[source.id] = record;
    this.write(file);
    return { ...record };
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }

  get(cognitionId: string): ProfileOverrideRecord | null {
    const record = this.read().overrides[cognitionId];
    return record ? JSON.parse(JSON.stringify(record)) as ProfileOverrideRecord : null;
  }

  list(): Array<{ cognitionId: string } & ProfileOverrideRecord> {
    return Object.entries(this.read().overrides).map(([cognitionId, record]) => ({ cognitionId, ...record }));
  }

  keepIndependent(cognitionId: string, now = new Date().toISOString()): ProfileOverrideRecord | null {
    const file = this.read();
    const record = file.overrides[cognitionId];
    if (!record) return null;
    record.independent = true;
    record.mutedAt = null;
    record.updatedAt = now;
    this.write(file);
    return { ...record };
  }

  setIndependentMuted(cognitionId: string, muted: boolean, now = new Date().toISOString()): ProfileOverrideRecord | null {
    const file = this.read();
    const record = file.overrides[cognitionId];
    if (!record?.independent) return null;
    record.mutedAt = muted ? now : null;
    record.updatedAt = now;
    this.write(file);
    return { ...record };
  }

  effectiveContent(cognitionId: string, originalContent: string): string {
    return this.read().overrides[cognitionId]?.content ?? originalContent;
  }

  applyCognitions<T extends SourceCognition>(items: readonly T[]): Array<T & OverlayView> {
    const file = this.read();
    const overrides = file.overrides;
    const sourceById = new Map(items.map((item) => [item.id, item]));
    const result: Array<T & OverlayView> = [];
    for (const item of items) {
      const record = overrides[item.id];
      if (!record) {
        const rejection = file.rejections[item.id];
        result.push({
          ...item,
          overridden: false,
          ...(rejection && item.invalidAt ? { rejectedByUser: true, rejectedAt: rejection.rejectedAt } : {}),
        });
      } else if (record.independent) {
        result.push({
          ...item,
          content: record.content,
          invalidAt: null,
          archivedAt: null,
          mutedAt: record.mutedAt ?? null,
          overridden: true,
          independent: true,
          needsReview: false,
          sourceMissing: false,
          sourceInvalidAt: item.invalidAt ?? null,
          sourceArchivedAt: item.archivedAt ?? null,
          originalContent: record.sourceSnapshot?.content ?? item.content,
          overrideUpdatedAt: record.updatedAt,
          restoredFromRejection: record.restoredFromRejection === true,
        } as T & OverlayView);
      } else if (item.invalidAt || item.archivedAt) {
        result.push({
          ...item,
          content: record.content,
          invalidAt: null,
          archivedAt: null,
          mutedAt: null,
          overridden: true,
          independent: false,
          needsReview: true,
          sourceMissing: false,
          sourceInvalidAt: item.invalidAt ?? null,
          sourceArchivedAt: item.archivedAt ?? null,
          originalContent: record.sourceSnapshot?.content ?? item.content,
          overrideUpdatedAt: record.updatedAt,
        } as T & OverlayView);
      } else {
        result.push({ ...item, content: record.content, originalContent: item.content, overridden: true, independent: false, needsReview: false, overrideUpdatedAt: record.updatedAt });
      }
    }
    for (const [id, record] of Object.entries(overrides)) {
      if (!sourceById.has(id)) result.push(syntheticCognition(id, record, !record.independent) as T & OverlayView);
    }
    return result;
  }

  /** 有任一覆盖时，无 id 的召回项无法证明不是旧文案，故 fail-closed 丢弃。 */
  applyRecall<T extends { id?: string; content: string }>(items: readonly T[], sources: readonly SourceCognition[] = []): T[] {
    const file = this.read();
    const overrides = file.overrides;
    if (Object.keys(overrides).length === 0 && Object.keys(file.rejections).length === 0) return items.map((item) => ({ ...item }));
    const sourceById = new Map(sources.map((item) => [item.id, item]));
    const result: T[] = [];
    for (const item of items) {
      if (!item.id) continue;
      if (file.rejections[item.id]) continue;
      const record = overrides[item.id];
      if (!record) { result.push({ ...item }); continue; }
      if (record.independent) {
        if (!record.mutedAt) result.push({ ...item, content: record.content });
        continue;
      }
      const source = sourceById.get(item.id);
      if (!source || source.invalidAt || source.archivedAt || source.mutedAt) continue;
      result.push({ ...item, content: record.content });
    }
    return result;
  }

  /** 覆盖文本不在 Core 索引里，用局部词/CJK 2-gram 做有界补召回。 */
  matchingOverrides(
    items: readonly SourceCognition[], query: string, excludedIds: ReadonlySet<string>, limit: number,
  ): Array<{ id: string; content: string }> {
    if (limit <= 0) return [];
    const queryUnits = searchUnits(query);
    if (!queryUnits.size) return [];
    const file = this.read();
    const sourceById = new Map(items.map((item) => [item.id, item]));
    const matches: Array<{ id: string; content: string }> = [];
    for (const [id, record] of Object.entries(file.overrides)) {
      if (excludedIds.has(id)) continue;
      const source = sourceById.get(id);
      const usable = record.independent
        ? !record.mutedAt
        : !!source && !source.invalidAt && !source.archivedAt && !source.mutedAt;
      if (!usable) continue;
      const contentUnits = searchUnits(record.content);
      if ([...queryUnits].some((unit) => contentUnits.has(unit))) matches.push({ id, content: record.content });
      if (matches.length >= limit) break;
    }
    return matches;
  }
}
