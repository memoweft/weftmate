import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { exactKeys, failure } from './common.mjs';
import { conversationMode } from './work-and-chat.mjs';

const execute = promisify(execFile);
export const MAX_WORKSPACE_TEXT = 512 * 1024;
const MAX_PREVIEW = 8 * 1024 * 1024, MAX_ENTRIES = 1000, MAX_VISITED = 10000;
const versions = new Map();
const media = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.pdf', 'application/pdf']]);

// This is the network boundary. Neither an absolute directory nor an owner is accepted.
function relativePath(value, empty = false) {
  if (typeof value !== 'string' || value.length > 2048 || (!empty && !value) ||
      /[\x00-\x1f\x7f\\:]/.test(value) || value.startsWith('/') ||
      value.split('/').some(part => part === '..' || part === '.' || part.toLowerCase() === '.git' ||
        /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
      (value && value.split('/').some(part => !part))) throw failure('WORKSPACE_UNSAFE_PATH', 400);
  return value;
}
const inside = (root, target) => { const rel = path.relative(root, target); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

async function checkedPath(project, rel = '', allowMissing = false) {
  relativePath(rel, true);
  const root = await realpath(project.rootPath);
  const canonical = value => process.platform === 'win32' ? path.resolve(value.replace(/^\\\\\?\\/, '')).toLowerCase() : path.resolve(value);
  const rootInfo = await lstat(project.rootPath, { bigint: true });
  const rootIdentity = `${(rootInfo.dev & 0xffffffffn).toString(16).padStart(8, '0')}:${rootInfo.ino.toString(16).padStart(16, '0')}`.toUpperCase();
  if (rootInfo.isSymbolicLink() || (project.rootFinalPath && canonical(root) !== canonical(project.rootFinalPath)) ||
      (project.rootIdentity && rootIdentity !== project.rootIdentity))
    throw failure('PROJECT_REVOKED', 409);
  let target = project.rootPath;
  for (const part of rel ? rel.split('/') : []) {
    target = path.join(target, part);
    let info;
    try { info = await lstat(target); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return target; throw error; }
    if (info.isSymbolicLink()) throw failure('WORKSPACE_UNSAFE_PATH', 403);
  }
  const final = await realpath(target);
  if (!inside(root, final)) throw failure('WORKSPACE_UNSAFE_PATH', 403);
  return target;
}

const version = (bytes, info) => createHash('sha256').update(bytes).update(`\0${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}`).digest('hex');
const text = bytes => { if (bytes.includes(0)) return null; try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; } };

async function boundedRead(file, limit) {
  const bytes = Buffer.alloc(limit + 1); let length = 0;
  while (length < bytes.length) {
    const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
    if (!bytesRead) break; length += bytesRead;
  }
  return bytes.subarray(0, length);
}

async function read(project, rel) {
  const target = await checkedPath(project, rel), file = await open(target, 'r');
  try {
    const info = await file.stat({ bigint: true }), current = await lstat(target, { bigint: true });
    if (!info.isFile() || info.nlink !== 1n || current.isSymbolicLink() || current.ino !== info.ino || current.dev !== info.dev) throw failure('WORKSPACE_UNSAFE_PATH', 403);
    const size = Number(info.size), type = media.get(path.extname(rel).toLowerCase());
    const base = { path: rel, name: path.basename(rel), size, contentType: type ?? 'application/octet-stream', kind: 'unsupported' };
    const limit = type ? MAX_PREVIEW : MAX_WORKSPACE_TEXT;
    if (size > limit) return { ...base, reason: 'too-large' };
    // Bounded handle read, including files growing after stat.
    const data = await boundedRead(file, Math.min(size, limit));
    if (data.length > limit) return { ...base, reason: 'too-large' };
    const after = await file.stat({ bigint: true });
    if (after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs || after.size !== info.size) throw failure('WORKSPACE_FILE_CHANGED', 409);
    await checkedPath(project, rel);
    const stamp = version(data, after);
    if (type) return { ...base, kind: type === 'application/pdf' ? 'pdf' : 'image', base64: data.toString('base64'), version: stamp };
    const content = text(data);
    return content === null ? base : { ...base, kind: 'text', contentType: 'text/plain', text: content, version: stamp, writable: project.permission === 'write' };
  } finally { await file.close(); }
}

async function listing(project, rel) {
  const target = await checkedPath(project, rel), entries = []; let truncated = false;
  for await (const entry of await opendir(target)) {
    if (entry.name.toLowerCase() === '.git') continue;
    try { relativePath(entry.name); } catch { continue; }
    entries.push({ name: entry.name, path: rel ? rel + '/' + entry.name : entry.name,
      type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported' });
    if (entries.length === MAX_ENTRIES) { truncated = true; break; }
  }
  entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
  return { entries, truncated };
}

async function search(project, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\x00-\x1f]/.test(query)) throw failure('INVALID_REQUEST');
  const queue = [''], entries = [], needle = query.toLocaleLowerCase(); let visited = 0, truncated = false;
  for (let index = 0; index < queue.length; index++) {
    const dir = await listing(project, queue[index]); truncated ||= dir.truncated;
    for (const item of dir.entries) {
      if (++visited > MAX_VISITED) return { entries, truncated: true };
      if (item.type === 'directory') queue.push(item.path);
      if (item.type === 'file' && item.name.toLocaleLowerCase().includes(needle)) entries.push(item);
      if (entries.length === MAX_ENTRIES) return { entries, truncated: true };
    }
  }
  return { entries, truncated };
}

async function save(project, input, authorize) {
  relativePath(input.path);
  if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > MAX_WORKSPACE_TEXT ||
      input.text.includes('\0') || !/^[a-f0-9]{64}$/.test(input.version ?? '')) throw failure('INVALID_REQUEST');
  const target = await checkedPath(project, input.path);
  const lockKey = process.platform === 'win32' ? target.toLowerCase() : target;
  const prior = versions.get(lockKey) ?? Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    authorize();
    if (project.permission !== 'write') throw failure('WORKSPACE_READ_ONLY', 403);
    const current = await read(project, input.path);
    if (current.kind !== 'text' || current.version !== input.version) throw failure('WORKSPACE_FILE_CHANGED', 409);
    const file = await open(await checkedPath(project, input.path), 'r+');
    try {
      const info = await file.stat({ bigint: true });
      if (!info.isFile() || Number(info.size) > MAX_WORKSPACE_TEXT) throw failure('WORKSPACE_FILE_CHANGED', 409);
      const data = await boundedRead(file, Number(info.size));
      const named = await lstat(target, { bigint: true });
      await checkedPath(project, input.path);
      authorize();
      const beforeWrite = await file.stat({ bigint: true });
      if (beforeWrite.nlink !== 1n || named.isSymbolicLink() || named.ino !== info.ino || named.dev !== info.dev ||
          version(data, beforeWrite) !== input.version) throw failure('WORKSPACE_FILE_CHANGED', 409);
      const bytes = Buffer.from(input.text);
      await file.writeFile(bytes); await file.truncate(bytes.length); await file.sync();
      const after = await file.stat({ bigint: true });
      return { path: input.path, version: version(bytes, after), saved: true };
    } finally { await file.close(); }
  });
  versions.set(lockKey, operation);
  try { return await operation; } finally { if (versions.get(lockKey) === operation) versions.delete(lockKey); }
}

async function git(root, args, allowed = [0]) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_COUNT: '0', GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXTERNAL_DIFF', 'GIT_CONFIG_PARAMETERS']) delete env[key];
  try {
    return (await execute('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', root, ...args],
      { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, env })).stdout;
  } catch (error) {
    if (allowed.includes(error.code)) return error.stdout;
    throw failure(error.code === 'ENOENT' ? 'WORKSPACE_GIT_UNAVAILABLE' : 'WORKSPACE_READ_FAILED', 503);
  }
}

async function gitContext(project) {
  const root = await checkedPath(project);
  // rev-parse failure includes a directory which is not a Git repository.
  const result = await git(root, ['rev-parse', '--is-inside-work-tree'], [0, 128]);
  if (result.trim() !== 'true') throw failure('WORKSPACE_NOT_GIT', 409);
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], [0, 128])).trim();
  return { root, prefix, head: /^[a-f0-9]{40,64}$/.test(head) ? 'HEAD' : null };
}

export function diffLines(raw) {
  let oldLine = 0, newLine = 0, inHunk = false;
  return raw.split('\n').filter((line, index, all) => index < all.length - 1 || line).map(line => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (match) { oldLine = Number(match[1]); newLine = Number(match[2]); inHunk = true; return { type: 'hunk', text: line }; }
    if (inHunk && line.startsWith('+')) return { type: 'add', text: line.slice(1), newLine: newLine++ };
    if (inHunk && line.startsWith('-')) return { type: 'del', text: line.slice(1), oldLine: oldLine++ };
    if (inHunk && line.startsWith(' ')) return { type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ };
    return { type: 'meta', text: line };
  });
}

async function status(project, known) {
  const { root, prefix, head } = known ?? await gitContext(project);
  const [raw, counts] = await Promise.all([git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    head ? git(root, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--relative', head, '--', '.']) : Promise.resolve('')]);
  const stats = new Map(), countParts = counts.split('\0');
  for (let i = 0; i < countParts.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(countParts[i]); if (!match) continue;
    let name = match[3]; if (!name) { i++; name = countParts[++i]; }
    stats.set(name, { additions: match[1] === '-' ? null : Number(match[1]), deletions: match[2] === '-' ? null : Number(match[2]) });
  }
  const parts = raw.split('\0'), files = [], untracked = []; let truncated = false;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]; if (!part) continue;
    const state = part.slice(0, 2), repoPath = part.slice(3);
    const oldPath = /[RC]/.test(state) ? parts[++index] : null;
    if (!repoPath.startsWith(prefix)) continue;
    const rel = repoPath.slice(prefix.length); try { relativePath(rel); } catch { continue; }
    const count = stats.get(rel) ?? { additions: 0, deletions: 0 };
    if (state === '??' || !head) {
      untracked.push(files.length);
    }
    files.push({ path: rel, status: state, ...count, ...(oldPath?.startsWith(prefix) ? { oldPath: oldPath.slice(prefix.length) } : {}) });
    if (files.length === MAX_ENTRIES) { truncated = true; break; }
  }
  // Independent handle reads use bounded concurrency; a large untracked tree must
  // not turn one refresh into hundreds of serial filesystem round trips.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(12, untracked.length) }, async () => {
    while (next < untracked.length) {
      const file = files[untracked[next++]];
      try {
        const content = media.has(path.extname(file.path).toLowerCase()) ? null : await read(project, file.path);
        Object.assign(file, content?.kind === 'text'
          ? { additions: content.text ? content.text.split('\n').length - Number(content.text.endsWith('\n')) : 0, deletions: 0 }
          : { additions: null, deletions: null });
      } catch { Object.assign(file, { additions: null, deletions: null }); }
    }
  }));
  return { files, truncated };
}

async function diff(project, input) {
  relativePath(input.path);
  const known = await gitContext(project), found = (await status(project, known)).files.find(row => row.path === input.path);
  if (!found) throw failure('NOT_FOUND', 404);
  let raw;
  if (found.status === '??' || !known.head) {
    const data = await read(project, input.path);
    if (data.kind !== 'text') return { path: input.path, lines: [], binary: true };
    const lines = data.text.split('\n'); if (data.text.endsWith('\n') || !data.text) lines.pop();
    raw = `@@ -0,0 +1,${lines.length} @@\n` + lines.map(line => '+' + line).join('\n');
  } else {
    // Deleted files have no realpath, but every existing parent still stays inside the grant.
    await checkedPath(project, input.path, true);
    raw = await git(known.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--relative', known.head, '--',
      ...(found.oldPath ? [found.oldPath] : []), input.path]);
  }
  return { path: input.path, lines: diffLines(raw), binary: /^Binary files |^GIT binary patch/m.test(raw) };
}

export async function handleWorkspaceFiles(context, request, response, ownerId, url) {
  const match = /^\/personal\/v1\/workspaces\/([A-Za-z0-9_-]{1,128})\/(review\/(status|diff)|files\/(list|search|read|save))$/.exec(url.pathname);
  if (!match) return false;
  const action = match[3] ?? match[4], writing = action === 'save';
  if (url.search || request.method !== (action === 'status' ? 'GET' : 'POST')) throw failure('INVALID_REQUEST');
  const auth = context.authenticate(request, writing ? 'commands:write' : 'sessions:read');
  const grant = () => {
    const account = context.accountState(ownerId), session = account.sessions[match[1]];
    if (!session || !context.hostOwner(ownerId) || (session.workHostId && session.workHostId !== account.hostId)) throw failure('NOT_FOUND', 404);
    if (conversationMode(session) !== 'work' || !session.projectId) throw failure('PROJECT_NOT_SELECTED', 409);
    const project = account.projects[session.projectId];
    if (!project || project.revoked || project.removed || project.revision !== session.projectRevision) throw failure('PROJECT_REVOKED', 409);
    return project;
  };
  const project = grant();
  const authorize = () => {
    const latest = context.authenticate(request, writing ? 'commands:write' : 'sessions:read');
    if (latest.ownerId !== auth.ownerId || latest.deviceId !== auth.deviceId || grant().revision !== project.revision || grant().projectId !== project.projectId) throw failure('PROJECT_REVOKED', 409);
  };
  const input = action === 'status' ? {} : await context.readJson(request, writing ? MAX_WORKSPACE_TEXT * 6 + 4096 : 16 * 1024);
  const keys = { status: [], diff: ['path'], list: ['path'], search: ['query'], read: ['path'], save: ['path', 'text', 'version'] }[action];
  exactKeys(input, keys, keys);
  try {
    const result = action === 'status' ? await status(project) : action === 'diff' ? await diff(project, input) :
      action === 'list' ? await listing(project, relativePath(input.path, true)) : action === 'search' ? await search(project, input.query) :
        action === 'read' ? await read(project, relativePath(input.path)) : await save(project, input, authorize);
    authorize(); context.json(response, 200, result);
  } catch (error) {
    if (error.code?.startsWith('WORKSPACE_') || error.code?.startsWith('PROJECT_') || ['INVALID_REQUEST', 'NOT_FOUND', 'UNAUTHORIZED'].includes(error.code)) throw error;
    throw failure('WORKSPACE_READ_FAILED', 503);
  }
  return true;
}
