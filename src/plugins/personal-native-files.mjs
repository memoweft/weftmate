import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { executionDirectory } from './personal-project-context.mjs';
import { shellScriptInvocations, scriptWriteTargets } from './personal-write-targets.mjs';
const additions = new WeakMap();
const fileDigest = async file => { const hash=createHash('sha256'); for await(const chunk of createReadStream(file))hash.update(chunk); return hash.digest('hex'); };
const fileKey = file => process.platform === 'win32' ? file.toLowerCase() : file;
const fileProducers = new Set(['write', 'edit', 'pwsh', 'bash', 'shell']);
const snapshotEntry = (file, stat) => ({filePath:file,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});

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
export async function snapshotFiles(directory, issues = []) {
  const files = new Map();
  const deadline=Date.now()+1000;let entriesSeen=0;
  async function visit(root) {
    if (Date.now()>deadline || entriesSeen>=10000) { if(!issues.includes('OBSERVATION_LIMIT'))issues.push('OBSERVATION_LIMIT');return; }
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') issues.push(error.code ?? 'OBSERVATION_FAILED'); return; }
    for (const entry of entries) {
      if (++entriesSeen>10000 || Date.now()>deadline) { if(!issues.includes('OBSERVATION_LIMIT'))issues.push('OBSERVATION_LIMIT');return; }
      const file = path.join(root, entry.name);
      // Browser captures are host-owned research inputs. Registering them as
      // user deliverables races concurrent reads and creates uncertain write
      // receipts that block the actual document tools (PF-2 LAN evidence).
      if (entry.isDirectory() && !['.weftmate-web-sources','.git','node_modules'].includes(entry.name)) await visit(file);
      else if (entry.isFile()) {
        try {
          const stat = await lstat(file);
          files.set(fileKey(file), snapshotEntry(file, stat));
        } catch (error) { if (error.code !== 'ENOENT') issues.push(error.code ?? 'OBSERVATION_FAILED'); }
      }
    }
  }
  try { await visit(await realpath(directory)); }
  catch (error) { if (error.code !== 'ENOENT') issues.push(error.code ?? 'OBSERVATION_FAILED'); }
  return files;
}

async function snapshotFor(exec, scriptFiles, issues) {
  const cwd = executionDirectory(exec.agent.session);
  const direct = ['write','edit'].includes(exec.name);
  const files = direct ? new Map() : await snapshotFiles(cwd, issues);
  // Native shell workdir and native file arguments can name user-selected paths.
  const workdir = exec.arguments?.workdir;
  if (!direct && typeof workdir === 'string' && fileKey(path.resolve(cwd,workdir)) !== fileKey(path.resolve(cwd))) {
    for (const entry of await snapshotFiles(path.resolve(cwd, workdir), issues)) files.set(...entry);
  }
  const explicitFiles = ['write', 'edit'].includes(exec.name) && typeof exec.arguments?.file_path === 'string'
    ? [path.resolve(cwd, exec.arguments.file_path)] : [];
  explicitFiles.push(...scriptFiles);
  for (const file of new Set(explicitFiles)) {
    try {
      const stat = await lstat(file);
      if (stat.isFile()) files.set(fileKey(await realpath(file)), {...snapshotEntry(file,stat),
        ...(direct ? {sha256:await fileDigest(file)} : {})});
    } catch (error) { if (error.code !== 'ENOENT') issues.push(error.code ?? 'OBSERVATION_FAILED'); }
  }
  return files;
}

/** Keep the native outcome and add host-owned references to files it changed. */
export async function trackNativeFiles(bridge, exec, next, identity) {
  const cwd = executionDirectory(exec.agent?.session);
  if (exec.agent?.session?.header?.agentPreset !== 'personal-remote' || !cwd || !fileProducers.has(exec.name)) return next();
  // Compare the same selected script outputs on both sides. A script can
  // change its own source; that must not turn an unobserved existing output
  // into a claimed creation after execution.
  const scriptFiles = ['pwsh', 'bash', 'shell'].includes(exec.name)
    ? shellScriptInvocations(exec.arguments?.command ?? '', path.resolve(cwd, exec.arguments?.workdir ?? '.'), exec.name !== 'bash')
      .flatMap(scriptWriteTargets) : [];
  const issues = [];
  const before = await snapshotFor(exec, scriptFiles, issues);
  const result = await next();
  const after = await snapshotFor(exec, scriptFiles, issues);
  const artifacts = [];
  for (const [key, current] of after) {
    const previous = before.get(key);
    if (current.sha256 && previous?.sha256 === current.sha256) continue;
    // Windows sandbox ACL preparation changes ctime without changing content.
    if (previous && previous.size === current.size && previous.mtimeMs === current.mtimeMs) continue;
    const file = current.filePath;
    try {
      const registered = await bridge.request({ action: 'register_file', ...identity(exec),
        filePath: file, sha256: current.sha256 ?? await fileDigest(file) }, exec.signal);
      artifacts.push(registered.artifactId ? { artifact: registered,
        ...(!before.has(key) && !issues.length ? { createdFilePath: file } : {}) } : { fileName: path.basename(file), ...registered });
    } catch (error) { issues.push(error.code ?? 'OBSERVATION_FAILED'); }
  }
  if (issues.length) artifacts.push({artifactObservation:{state:'incomplete',instruction:'File observation or artifact registration was incomplete. The tool outcome is unchanged. Inspect actual files if needed; do_not_repeat an operation just to recreate its artifact card.'}});
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
