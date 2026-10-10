import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { executionDirectory } from './personal-project-context.mjs';
import { shellScriptInvocations, scriptWriteTargets } from './personal-write-targets.mjs';
const additions = new WeakMap();
const fileDigest = async file => { const hash=createHash('sha256'); for await(const chunk of createReadStream(file))hash.update(chunk); return hash.digest('hex'); };
const fileKey = file => process.platform === 'win32' ? file.toLowerCase() : file;

/** Keep the original native grant while an asynchronous child outlives the parent turn.
 * Registration still verifies that receipt, owner and task in the host. */
export function createNativeFileProvenance(resolveIdentity) {
  const inherited = new WeakMap();
  return {
    inherit(agent, dispatch) {
      inherited.set(agent, Object.freeze({ ...(inherited.get(dispatch.agent) ?? resolveIdentity(dispatch)) }));
    },
    identity(exec) { return inherited.get(exec.agent) ?? resolveIdentity(exec); },
  };
}

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
      // Browser captures are host-owned research inputs. Registering them as
      // user deliverables races concurrent reads and creates uncertain write
      // receipts that block the actual document tools (PF-2 LAN evidence).
      if (entry.isDirectory() && entry.name !== '.weftmate-web-sources') await visit(file);
      else if (entry.isFile()) {
        try {
          const stat = await lstat(file);
          files.set(fileKey(file), { filePath: file, size: stat.size, mtimeMs: stat.mtimeMs,
            sha256: await fileDigest(file) });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  try { await visit(await realpath(directory)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}

async function snapshotFor(exec, scriptFiles) {
  const cwd = executionDirectory(exec.agent.session);
  const files = await snapshotFiles(cwd);
  // Native shell workdir and native file arguments can name user-selected paths.
  const workdir = exec.arguments?.workdir;
  if (typeof workdir === 'string') {
    for (const entry of await snapshotFiles(path.resolve(cwd, workdir))) files.set(...entry);
  }
  const explicitFiles = ['write', 'edit'].includes(exec.name) && typeof exec.arguments?.file_path === 'string'
    ? [path.resolve(cwd, exec.arguments.file_path)] : [];
  explicitFiles.push(...scriptFiles);
  for (const file of new Set(explicitFiles)) {
    try {
      const stat = await lstat(file);
      if (stat.isFile()) files.set(fileKey(await realpath(file)), { filePath: file, size: stat.size, mtimeMs: stat.mtimeMs,
        sha256: await fileDigest(file) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files;
}

/** Keep the native outcome and add host-owned references to files it changed. */
export async function trackNativeFiles(bridge, exec, next, identity) {
  const cwd = executionDirectory(exec.agent?.session);
  if (exec.agent?.session?.header?.agentPreset !== 'personal-remote' || !cwd) return next();
  // Compare the same selected script outputs on both sides. A script can
  // change its own source; that must not turn an unobserved existing output
  // into a claimed creation after execution.
  const scriptFiles = ['pwsh', 'bash', 'shell'].includes(exec.name)
    ? shellScriptInvocations(exec.arguments?.command ?? '', path.resolve(cwd, exec.arguments?.workdir ?? '.'), exec.name !== 'bash')
      .flatMap(scriptWriteTargets) : [];
  const before = await snapshotFor(exec, scriptFiles);
  const result = await next();
  const after = await snapshotFor(exec, scriptFiles);
  const artifacts = [];
  for (const [key, current] of after) {
    if (before.get(key)?.sha256 === current.sha256) continue;
    const file = current.filePath;
    const registered = await bridge.request({ action: 'register_file', ...identity(exec),
      filePath: file, sha256: current.sha256 }, exec.signal);
    artifacts.push(registered.artifactId ? { artifact: registered,
      ...(!before.has(key) ? { createdFilePath: file } : {}) } : { fileName: path.basename(file), ...registered });
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
