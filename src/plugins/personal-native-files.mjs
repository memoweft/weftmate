import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
const additions = new WeakMap();

/** Creation provenance survives turns/restarts in the native artifact results. */
export function conversationCreatedFiles(session) {
  const files = new Set();
  for (const event of session.events ?? []) {
    if (event.type !== 'tool/result') continue;
    for (const result of event.data?.message?.content ?? []) {
      if (result.type !== 'tool-result') continue;
      for (const block of result.content ?? []) {
        if (block.type !== 'text') continue;
        try {
          const value = JSON.parse(block.text);
          if (value.artifact?.artifactId && typeof value.createdFilePath === 'string') files.add(path.resolve(value.createdFilePath));
        } catch { /* Ordinary tool text. */ }
      }
    }
  }
  return files;
}

/** Observe ordinary files, without following links into another directory. */
export async function snapshotFiles(directory) {
  const files = new Map();
  async function visit(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        try {
          const stat = await lstat(file);
          files.set(file, { size: stat.size, mtimeMs: stat.mtimeMs,
            sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  try { await visit(await realpath(directory)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}

async function snapshotFor(exec) {
  const cwd = exec.agent.session.header.cwd;
  const files = await snapshotFiles(cwd);
  // Native shell workdir and native file arguments can name user-selected paths.
  const workdir = exec.arguments?.workdir;
  if (typeof workdir === 'string') {
    for (const entry of await snapshotFiles(path.resolve(cwd, workdir))) files.set(...entry);
  }
  if (['write', 'edit'].includes(exec.name) && typeof exec.arguments?.file_path === 'string') {
    const file = path.resolve(cwd, exec.arguments.file_path);
    try {
      const stat = await lstat(file);
      if (stat.isFile()) files.set(file, { size: stat.size, mtimeMs: stat.mtimeMs,
        sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files;
}

/** Keep the native outcome and add host-owned references to files it changed. */
export async function trackNativeFiles(bridge, exec, next, identity) {
  const cwd = exec.agent?.session?.header?.cwd;
  if (exec.agent?.session?.header?.origin === 'subagent' ||
      exec.agent?.session?.header?.agentPreset !== 'personal-remote' || !cwd) return next();
  const before = await snapshotFor(exec);
  const result = await next();
  const after = await snapshotFor(exec);
  const artifacts = [];
  for (const [file, current] of after) {
    if (before.get(file)?.sha256 === current.sha256) continue;
    const registered = await bridge.request({ action: 'register_file', ...identity(exec),
      filePath: file, sha256: current.sha256 }, exec.signal);
    artifacts.push(registered.artifactId ? { artifact: registered,
      ...(!before.has(file) ? { createdFilePath: file } : {}) } : { fileName: path.basename(file), ...registered });
  }
  if (!artifacts.length) return result;
  additions.set(exec, artifacts.map(value => ({ type: 'text', text: JSON.stringify(value) })));
  return result;
}

/** DSH accepts durable content enrichment in post-execute, after output schema normalization. */
export async function appendNativeArtifacts(exec, result, next) {
  const decision = await next();
  const content = additions.get(exec);
  additions.delete(exec);
  if (!content || decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision;
  return { ...decision, content: [...(decision.content ?? result.content), ...content] };
}
