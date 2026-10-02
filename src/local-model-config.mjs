import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const FORMAL_LOCAL_BASE_URL = 'http://127.0.0.1:8081/v1';
const USER_KEY_NAME = 'MODEL_SWITCH_UNIFIED_KEY';
const MAX_CONTEXT_WINDOW = 1_048_576;
const MAX_OUTPUT_RESERVE = 131_072;
export const OCCAMY_VISION_MODEL_ID = 'occamy-miniplus-v21';
export const OCCAMY_VISION_PROFILE_ID = 'personal-local-occamy-miniplus-v21';
const OCCAMY_VISION_ROUTE = `weftmate-${createHash('sha256').update(OCCAMY_VISION_PROFILE_ID).digest('hex').slice(0, 24)}`;

function refused(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function findFormalLocalModel(modelId, catalogDir = 'D:\\AI\\Config') {
  if (typeof modelId !== 'string' || !MODEL_ID.test(modelId) || !path.isAbsolute(catalogDir)) {
    throw refused('LOCAL_MODEL_INVALID');
  }
  const root = await lstat(catalogDir);
  if (!root.isDirectory() || root.isSymbolicLink()) throw refused('LOCAL_MODEL_INVALID');
  const matches = [];
  for (const entry of await readdir(catalogDir, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json') || !entry.isFile() || entry.isSymbolicLink()) continue;
    const file = path.join(catalogDir, entry.name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) continue;
    let parsed;
    try { parsed = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
    if (parsed?.dsh_model_id === modelId) matches.push(parsed);
  }
  if (matches.length !== 1) throw refused('LOCAL_MODEL_INVALID');
  const selected = matches[0];
  const contextWindow = selected.context_window;
  const outputReserve = selected.output_reserve;
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 4_096 || contextWindow > MAX_CONTEXT_WINDOW ||
      !Number.isSafeInteger(outputReserve) || outputReserve < 1 || outputReserve > MAX_OUTPUT_RESERVE ||
      outputReserve >= contextWindow ||
      (selected.ctx_size !== undefined && selected.ctx_size !== contextWindow) ||
      (selected.max_context !== undefined && selected.max_context !== contextWindow)) {
    throw refused('LOCAL_MODEL_INVALID');
  }
  const displayName = selected.display_name;
  return { modelId, name: typeof displayName === 'string' && displayName.trim()
    ? displayName.trim().slice(0, 120) : modelId,
  contextWindow, outputReserve };
}

/** Read formal metadata only; no key lookup, service request or model load. */
export async function listFormalLocalModels(catalogDir = 'D:\\AI\\Config') {
  if (typeof catalogDir !== 'string' || !path.isAbsolute(catalogDir)) throw refused('LOCAL_MODEL_INVALID');
  const root = await lstat(catalogDir);
  if (!root.isDirectory() || root.isSymbolicLink()) throw refused('LOCAL_MODEL_INVALID');
  const ids = [];
  for (const entry of await readdir(catalogDir, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json') || !entry.isFile() || entry.isSymbolicLink()) continue;
    const file = path.join(catalogDir, entry.name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) continue;
    let value;
    try { value = JSON.parse(await readFile(file, 'utf8')); } catch { throw refused('LOCAL_MODEL_INVALID'); }
    if (typeof value?.dsh_model_id !== 'string' || !MODEL_ID.test(value.dsh_model_id)) throw refused('LOCAL_MODEL_INVALID');
    ids.push(value.dsh_model_id);
  }
  if (ids.length < 1 || ids.length > 24 || new Set(ids).size !== ids.length) throw refused('LOCAL_MODEL_INVALID');
  return Promise.all(ids.sort().map((id) => findFormalLocalModel(id, catalogDir)));
}

/** Read only the Windows User environment value through a fixed system PowerShell. */
export async function readUserModelSwitcherKey({ systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  exec = execFileAsync } = {}) {
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${USER_KEY_NAME}', 'User'))`;
  try {
    const { stdout } = await exec(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024,
      env: { ...process.env, PSModulePath: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
    });
    const key = String(stdout);
    if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw refused('LOCAL_MODEL_CREDENTIAL_UNAVAILABLE');
    return key;
  } catch { throw refused('LOCAL_MODEL_CREDENTIAL_UNAVAILABLE'); }
}

export async function prepareLocalModelConfig({ modelId, name, catalogDir, readKey = readUserModelSwitcherKey }) {
  const formal = await findFormalLocalModel(modelId, catalogDir);
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 120)) {
    throw refused('LOCAL_MODEL_INVALID');
  }
  const apiKey = await readKey();
  return { id: `personal-local-${formal.modelId}`, name: name?.trim() ?? formal.name,
    provider: 'openai-compatible', baseUrl: FORMAL_LOCAL_BASE_URL, model: formal.modelId,
    contextWindow: formal.contextWindow, outputReserve: formal.outputReserve, apiKey };
}

/** Copy an owned Occamy provider and add image input without changing any other row or field. */
export function projectOccamyImageInput(actual, { route, modelId = OCCAMY_VISION_MODEL_ID } = {}) {
  if (route !== OCCAMY_VISION_ROUTE || modelId !== OCCAMY_VISION_MODEL_ID) throw refused('MODEL_ROUTE_BLOCKED');
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) ||
      actual.api !== 'openai-completions' || actual.baseURL !== FORMAL_LOCAL_BASE_URL ||
      actual.apiKeyEnv !== `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY` ||
      !Array.isArray(actual.models) || actual.models.length < 1) throw refused('MODEL_ROUTE_BLOCKED');
  const matches = actual.models.filter((item) => item?.id === OCCAMY_VISION_MODEL_ID);
  if (matches.length !== 1 || matches[0] === null || typeof matches[0] !== 'object' ||
      Array.isArray(matches[0])) throw refused('MODEL_ROUTE_BLOCKED');
  const current = matches[0].input;
  if (current !== undefined && !(Array.isArray(current) &&
      (current.length === 1 && current[0] === 'text' ||
        current.length === 2 && current[0] === 'text' && current[1] === 'image'))) {
    throw refused('MODEL_ROUTE_BLOCKED');
  }
  const desired = structuredClone(actual);
  desired.models[actual.models.findIndex((item) => item?.id === OCCAMY_VISION_MODEL_ID)].input = ['text', 'image'];
  return desired;
}

/** Reconcile only the formal Occamy model's live input declaration; retain every other provider field. */
export async function reconcileOccamyImageInput(client, { route, modelId = OCCAMY_VISION_MODEL_ID } = {}) {
  if (typeof client?.describeSettings !== 'function' || typeof client?.mutateSettings !== 'function') {
    throw refused('MODEL_ROUTE_BLOCKED');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await client.describeSettings();
    if (snapshot?.writable !== true || snapshot.applies !== 'live' ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw refused('MODEL_ROUTE_BLOCKED');
    const actual = snapshot.userProviders?.[route];
    const desired = projectOccamyImageInput(actual, { route, modelId });
    if (isDeepStrictEqual(actual, desired)) return false;
    try {
      await client.mutateSettings([{ op: 'set', path: ['providers', route], value: desired }], snapshot.revision);
    } catch (error) {
      if (error?.code === 'settings-conflict' && attempt < 2) continue;
      throw error;
    }
    const verified = await client.describeSettings();
    if (!verified?.userProviders || !isDeepStrictEqual(verified.userProviders[route], desired)) {
      throw refused('MODEL_ROUTE_BLOCKED');
    }
    return true;
  }
  throw refused('MODEL_ROUTE_BLOCKED');
}
