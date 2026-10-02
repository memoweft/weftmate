/**
 * Narrow, main-process-only helper for moving WeftMate's pre-official model
 * routes from the DSH CLI base overlay into DSH's durable `llm-pi-ai` user
 * settings namespace.  It deliberately owns neither credentials nor files:
 * callers copy safeStorage refs, retire the generated patch, and restart the
 * shared runtime only after this helper has returned successfully.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const OFFICIAL_DSH_SETTINGS_NAMESPACE = 'llm-pi-ai';

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OfficialDshClientOptions {
  origin: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  rpcIdFactory?: () => string;
}

export interface OfficialModelProjection {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}

export interface LegacyRouteProjection {
  route: string;
  displayName: string;
  baseURL: string;
  models: readonly OfficialModelProjection[];
}

export interface ProviderConfig {
  displayName: string;
  apiKeyEnv: string;
  api: 'openai-completions';
  baseURL: string;
  models: OfficialModelProjection[];
}

export interface NamespaceSnapshot {
  writable: boolean;
  applies: 'live' | 'restart';
  revision: number;
  baseProviders: Record<string, unknown>;
  userProviders: Record<string, unknown>;
}

export interface CredentialRow {
  configured: boolean;
  writable: boolean;
  source?: string;
}

export type SettingsPathSetOperation = {
  op: 'set';
  path: ['providers', string];
  value: ProviderConfig;
} | {
  op: 'unset';
  path: ['providers', string];
};

export interface MigrationPlan {
  operations: SettingsPathSetOperation[];
  skippedRoutes: string[];
}

export interface MigrationResult extends MigrationPlan {
  attempts: number;
  mutated: boolean;
  snapshot: NamespaceSnapshot;
}

export interface MigrationVerification {
  ok: boolean;
  reasons: string[];
}

export class OfficialDshRpcError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'OfficialDshRpcError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function copyRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  // HTTP JSON cannot contain functions or cycles.  Copying only this bounded
  // sub-tree prevents callers from accidentally retaining full descriptors.
  return structuredClone(value);
}

/** Only DSH's loopback HTTP carrier is trusted for this privileged main seam. */
export function assertOfficialDshLoopbackOrigin(origin: string): string {
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new TypeError('official DSH origin must be a URL'); }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new TypeError('official DSH origin must be exactly http://127.0.0.1:<port>');
  }
  return `http://127.0.0.1:${port}`;
}

/** The official Models UI derives this credential reference from the route. */
export function officialCredentialRef(route: string): string {
  requireString(route, 'route');
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

/** Projection intentionally contains route metadata only, never a key value. */
export function projectOfficialProviderConfig(route: LegacyRouteProjection): ProviderConfig {
  const routeName = requireString(route.route, 'route.route');
  return {
    displayName: requireString(route.displayName, 'route.displayName'),
    apiKeyEnv: officialCredentialRef(routeName),
    api: 'openai-completions',
    baseURL: requireString(route.baseURL, 'route.baseURL'),
    models: route.models.map((model) => ({
      id: requireString(model.id, 'model.id'),
      name: requireString(model.name, 'model.name'),
      contextWindow: finitePositiveInteger(model.contextWindow, 'model.contextWindow'),
      maxTokens: finitePositiveInteger(model.maxTokens, 'model.maxTokens'),
    })),
  };
}

function finitePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function rpcErrorFrom(result: unknown, method: string): OfficialDshRpcError {
  const error = isRecord(result) && isRecord(result.error) ? result.error : null;
  const code = error && typeof error.code === 'string' ? error.code : null;
  return new OfficialDshRpcError(`official DSH ${method} rejected the request`, code);
}

function assertResultEnvelope(value: unknown, rpcId: string, method: string): unknown {
  if (!isRecord(value) || value.type !== 'server-response' || value.rpcId !== rpcId || !isRecord(value.result)) {
    throw new OfficialDshRpcError(`official DSH ${method} returned an invalid response envelope`);
  }
  if (value.result.ok !== true) throw rpcErrorFrom(value.result, method);
  if (!Object.hasOwn(value.result, 'value')) throw new OfficialDshRpcError(`official DSH ${method} returned no result value`);
  return value.result.value;
}

function extractNamespace(value: unknown): NamespaceSnapshot {
  if (!isRecord(value) || typeof value.writable !== 'boolean' || !Array.isArray(value.namespaces)) {
    throw new OfficialDshRpcError('official DSH settings.describe returned an invalid result');
  }
  const descriptor = value.namespaces.find((candidate) => isRecord(candidate) && candidate.ns === OFFICIAL_DSH_SETTINGS_NAMESPACE);
  const revision = isRecord(descriptor) ? descriptor.revision : undefined;
  if (!isRecord(descriptor) || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new OfficialDshRpcError('official DSH llm-pi-ai settings namespace is unavailable');
  }
  if (descriptor.applies !== 'live' && descriptor.applies !== 'restart') {
    throw new OfficialDshRpcError('official DSH llm-pi-ai settings namespace has an invalid apply mode');
  }
  return {
    writable: value.writable,
    applies: descriptor.applies,
    revision,
    baseProviders: copyRecord(isRecord(descriptor.base) ? descriptor.base.providers : undefined),
    userProviders: copyRecord(isRecord(descriptor.user) ? descriptor.user.providers : undefined),
  };
}

function extractCredentialRows(value: unknown, refs: readonly string[]): Record<string, CredentialRow> {
  if (!isRecord(value) || !isRecord(value.credentials)) {
    throw new OfficialDshRpcError('official DSH credentials.describe returned an invalid result');
  }
  const result: Record<string, CredentialRow> = {};
  for (const ref of refs) {
    const row = value.credentials[ref];
    if (!isRecord(row) || typeof row.configured !== 'boolean' || typeof row.writable !== 'boolean') {
      throw new OfficialDshRpcError('official DSH credentials.describe returned an invalid credential row');
    }
    result[ref] = {
      configured: row.configured,
      writable: row.writable,
      ...(typeof row.source === 'string' ? { source: row.source } : {}),
    };
  }
  return result;
}

export interface OfficialDshSettingsClient {
  readonly origin: string;
  describeSettings(): Promise<NamespaceSnapshot>;
  mutateSettings(operations: readonly SettingsPathSetOperation[], expectedRevision: number): Promise<void>;
  describeCredentials(refs: readonly string[]): Promise<Record<string, CredentialRow>>;
}

/**
 * Minimal unary client rather than a generic DSH proxy.  It exposes only the
 * three formal APIs the migration needs and validates every carrier envelope.
 */
export function createOfficialDshSettingsClient(options: OfficialDshClientOptions): OfficialDshSettingsClient {
  const origin = assertOfficialDshLoopbackOrigin(options.origin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const rpcIdFactory = options.rpcIdFactory ?? randomUUID;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');

  async function unary(method: 'settings.describe' | 'settings.mutate' | 'credentials.describe', payload: JsonRecord): Promise<unknown> {
    const rpcId = rpcIdFactory();
    requireString(rpcId, 'rpcId');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(`/api/${method}`, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: abort.signal,
      });
      if (!response.ok) throw new OfficialDshRpcError(`official DSH ${method} carrier failed`);
      let body: unknown;
      try { body = await response.json(); } catch { throw new OfficialDshRpcError(`official DSH ${method} returned invalid JSON`); }
      return assertResultEnvelope(body, rpcId, method);
    } catch (error) {
      if (abort.signal.aborted) throw new OfficialDshRpcError(`official DSH ${method} timed out`);
      if (error instanceof OfficialDshRpcError) throw error;
      throw new OfficialDshRpcError(`official DSH ${method} carrier failed`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    origin,
    async describeSettings() { return extractNamespace(await unary('settings.describe', {})); },
    async mutateSettings(operations, expectedRevision) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a non-negative integer');
      await unary('settings.mutate', {
        ns: OFFICIAL_DSH_SETTINGS_NAMESPACE,
        ops: [...operations],
        expectedRevision,
      });
    },
    async describeCredentials(refs) {
      if (refs.length > 64) throw new TypeError('credentials.describe supports at most 64 refs');
      const normalized = refs.map((ref) => requireString(ref, 'credential ref'));
      return extractCredentialRows(await unary('credentials.describe', { refs: normalized }), normalized);
    },
  };
}

/**
 * A legacy base overlay may exist while this plan runs.  Only the durable user
 * layer determines whether migration is safe: an exact user route is already
 * migrated; any non-exact user route is an explicit user edit and is refused.
 */
export function planLegacyRouteMigration(routes: readonly LegacyRouteProjection[], snapshot: NamespaceSnapshot): MigrationPlan {
  if (!snapshot.writable) throw new OfficialDshRpcError('official DSH settings are not writable');
  const routeNames = new Set<string>();
  const operations: SettingsPathSetOperation[] = [];
  const skippedRoutes: string[] = [];
  for (const route of routes) {
    const routeName = requireString(route.route, 'route.route');
    if (routeNames.has(routeName)) throw new TypeError(`duplicate legacy route: ${routeName}`);
    routeNames.add(routeName);
    const desired = projectOfficialProviderConfig(route);
    if (!Object.hasOwn(snapshot.userProviders, routeName)) {
      operations.push({ op: 'set', path: ['providers', routeName], value: desired });
      continue;
    }
    if (!isDeepStrictEqual(snapshot.userProviders[routeName], desired)) {
      throw new OfficialDshRpcError(`legacy route ${routeName} conflicts with an existing official user route`);
    }
    skippedRoutes.push(routeName);
  }
  return { operations, skippedRoutes };
}

/** Re-describe on DSH's optimistic-concurrency conflict, at most three times. */
export async function migrateLegacyRoutes(
  client: OfficialDshSettingsClient,
  routes: readonly LegacyRouteProjection[],
  maxAttempts = 3,
): Promise<MigrationResult> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new TypeError('maxAttempts must be an integer from 1 through 3');
  for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
    const snapshot = await client.describeSettings();
    const plan = planLegacyRouteMigration(routes, snapshot);
    if (plan.operations.length === 0) return { ...plan, attempts, mutated: false, snapshot };
    try {
      await client.mutateSettings(plan.operations, snapshot.revision);
      return { ...plan, attempts, mutated: true, snapshot };
    } catch (error) {
      if (!(error instanceof OfficialDshRpcError) || error.code !== 'settings-conflict' || attempts === maxAttempts) throw error;
    }
  }
  throw new OfficialDshRpcError('legacy route migration exhausted its retry budget');
}

/**
 * Reconcile an earlier WeftMate local route whose only stale fields are the
 * formal model limits. Caller must already have proved exact profile/key
 * ownership and passed the host's session-idle and reference-scan guards.
 * An unrelated user edit is never overwritten.
 */
export async function repairOfficialLocalRouteLimits(
  client: OfficialDshSettingsClient,
  route: LegacyRouteProjection,
  maxAttempts = 3,
): Promise<boolean> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new TypeError('invalid retry budget');
  const desired = projectOfficialProviderConfig(route);
  if (desired.models.length !== 1) throw new TypeError('local route must have exactly one model');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const snapshot = await client.describeSettings();
    if (!snapshot.writable || snapshot.applies !== 'live') throw new OfficialDshRpcError('official settings are not writable live');
    const actual = snapshot.userProviders[route.route];
    if (isDeepStrictEqual(actual, desired)) return false;
    if (!isRecord(actual) || !Array.isArray(actual.models) || actual.models.length !== 1 || !isRecord(actual.models[0])) {
      throw new OfficialDshRpcError('official local route differs from the owned projection');
    }
    const existingModel = actual.models[0];
    if (typeof existingModel.contextWindow !== 'number' || typeof existingModel.maxTokens !== 'number'
      || !Number.isSafeInteger(existingModel.contextWindow) || !Number.isSafeInteger(existingModel.maxTokens)
      || existingModel.contextWindow < 1 || existingModel.maxTokens < 1) {
      throw new OfficialDshRpcError('official local route has invalid limits');
    }
    const previousLimits = { ...desired, models: [{ ...desired.models[0],
      contextWindow: existingModel.contextWindow, maxTokens: existingModel.maxTokens }] };
    if (!isDeepStrictEqual(actual, previousLimits)) {
      throw new OfficialDshRpcError('official local route differs from the owned projection');
    }
    try {
      await client.mutateSettings([{ op: 'set', path: ['providers', route.route], value: desired }], snapshot.revision);
      return true;
    } catch (error) {
      if (!(error instanceof OfficialDshRpcError) || error.code !== 'settings-conflict' || attempt === maxAttempts) throw error;
    }
  }
  throw new OfficialDshRpcError('official local route repair exhausted its retry budget');
}

/**
 * Call after the caller has retired the CLI base patch and (if necessary)
 * restarted the one shared runtime.  Credential rows are intentionally
 * metadata-only results from credentials.describe, never key values.
 */
export function verifyLegacyRouteMigration(
  routes: readonly LegacyRouteProjection[],
  snapshot: NamespaceSnapshot,
  credentialRows?: Readonly<Record<string, CredentialRow>>,
): MigrationVerification {
  const reasons: string[] = [];
  if (!snapshot.writable) reasons.push('official settings are not writable');
  if (snapshot.applies !== 'live') reasons.push('official settings do not apply live');
  for (const route of routes) {
    const routeName = route.route;
    const desired = projectOfficialProviderConfig(route);
    if (!Object.hasOwn(snapshot.userProviders, routeName) || !isDeepStrictEqual(snapshot.userProviders[routeName], desired)) {
      reasons.push(`user route ${routeName} is not an exact official projection`);
    }
    if (Object.hasOwn(snapshot.baseProviders, routeName)) reasons.push(`base route ${routeName} is still present`);
    if (credentialRows) {
      const credential = credentialRows[officialCredentialRef(routeName)];
      if (!credential?.configured || !credential.writable) reasons.push(`credential ${officialCredentialRef(routeName)} is not configured and writable`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
