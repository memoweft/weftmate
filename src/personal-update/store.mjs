import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compareVersions, sha256, verifyManifest } from './manifest.mjs';

export async function atomicJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data), { flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export function updateSource(url) {
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      !(parsed.protocol === 'https:' || parsed.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname))) throw new Error('invalid update source');
  return parsed;
}
export async function downloadBytes(url, size, fetcher = fetch) {
  const response = await fetcher(updateSource(url), { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('http update download failed');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > size) { await response.body.cancel?.().catch(() => {}); throw new Error('hash size exceeded'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Complete immutable versions plus one atomic pointer; no executable main-process code. */
export class UpdateStore {
  constructor({ root, layer = 'ui', trustedKeys, versions, channel = 'stable', builtInVersion = '0.1.0',
    builtInFile = () => null, allowedPaths = null, fetcher = fetch }) {
    Object.assign(this, { root, layer, trustedKeys, versions, channel, builtInVersion, builtInFile, allowedPaths, fetcher });
    this.pointer = { active: null, previous: null, staged: null, trial: false, rejected: [] };
    this.state = { layer, currentVersion: builtInVersion, availableVersion: null, status: 'idle', error: null, downloadedBytes: 0, reusedBytes: 0 };
  }
  options() { return { layer: this.layer, channel: this.channel, versions: this.versions }; }
  directory(id) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid version identity'); return join(this.root, 'versions', id); }
  async persist() { await atomicJson(join(this.root, 'current.json'), this.pointer); }
  async manifest(id) {
    const value = JSON.parse(await readFile(join(this.directory(id), 'manifest.json'), 'utf8'));
    verifyManifest(value, this.trustedKeys, this.options());
    if (sha256(JSON.stringify(value)) !== id) throw new Error('hash manifest changed');
    if (this.allowedPaths && value.files.some(file => !this.allowedPaths.has(file.path))) throw new Error('invalid resource path');
    return value;
  }
  async bytes(directory, file) {
    const target = join(directory, file.path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error('hash file size invalid');
    const data = await readFile(target);
    if (sha256(data) !== file.sha256) throw new Error('hash file invalid');
    return data;
  }
  async verifyVersion(id) {
    const manifest = await this.manifest(id);
    for (const file of manifest.files) await this.bytes(this.directory(id), file);
    return manifest;
  }
  async init() {
    await mkdir(join(this.root, 'versions'), { recursive: true });
    try { Object.assign(this.pointer, JSON.parse(await readFile(join(this.root, 'current.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') await this.rollback('hash update pointer invalid'); }
    if (this.pointer.trial) await this.rollback('startup self-check interrupted');
    if (this.pointer.active) {
      try { this.state.currentVersion = (await this.verifyVersion(this.pointer.active)).version; }
      catch { await this.rollback('hash installed version invalid'); }
    }
    if (this.pointer.staged) {
      try { this.state.availableVersion = (await this.verifyVersion(this.pointer.staged)).version; this.state.status = 'ready'; }
      catch { this.pointer.staged = null; await this.persist(); }
    }
    return this;
  }
  async check(manifestUrl) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.download(manifestUrl).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async download(manifestUrl) {
    this.state.status = 'checking'; this.state.error = null;
    try {
      const manifest = JSON.parse((await downloadBytes(manifestUrl, 1024 * 1024, this.fetcher)).toString('utf8'));
      verifyManifest(manifest, this.trustedKeys, this.options());
      if (this.allowedPaths && manifest.files.some(file => !this.allowedPaths.has(file.path))) throw new Error('invalid resource path');
      const id = sha256(JSON.stringify(manifest));
      this.state.availableVersion = manifest.version;
      if (this.pointer.rejected.includes(id)) throw new Error('startup version rejected');
      if (compareVersions(manifest.version, this.state.currentVersion) <= 0 || this.pointer.staged === id) {
        this.state.status = this.pointer.staged ? 'ready' : 'current'; return this.state;
      }
      this.state.status = 'downloading'; this.state.downloadedBytes = 0; this.state.reusedBytes = 0;
      const staging = join(this.root, 'versions', `${id}.${randomUUID()}.tmp`);
      await mkdir(staging);
      try {
        let activeManifest = null;
        if (this.pointer.active) activeManifest = await this.manifest(this.pointer.active);
        for (const file of manifest.files) {
          let data = null;
          const old = activeManifest?.files.find(row => row.path === file.path && row.sha256 === file.sha256 && row.size === file.size);
          try {
            if (old) data = await this.bytes(this.directory(this.pointer.active), file);
            else { const builtin = this.builtInFile(file.path); if (builtin) {
              const bytes = await readFile(builtin);
              if (bytes.length === file.size && sha256(bytes) === file.sha256) data = bytes;
            } }
          } catch { /* Repair a damaged local copy from the signed source. */ }
          if (data) this.state.reusedBytes += data.length;
          else {
            const base = manifest.assetBase ? new URL(manifest.assetBase, manifestUrl) : new URL(`./files/${manifest.layer}/${manifest.version}/`, manifestUrl);
            if (base.origin !== new URL(manifestUrl).origin) throw new Error('invalid update asset origin');
            data = await downloadBytes(new URL(file.path, base).href, file.size, this.fetcher);
            this.state.downloadedBytes += data.length;
            if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error('hash download invalid');
          }
          const destination = join(staging, file.path); await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, data, { flag: 'wx' });
        }
        await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
        try { await rename(staging, this.directory(id)); }
        catch (error) { if (!(await lstat(this.directory(id)).catch(() => null))?.isDirectory()) throw error; await this.verifyVersion(id); }
        this.pointer.staged = id; await this.persist(); this.state.status = 'ready';
      } finally { await rm(staging, { recursive: true, force: true }); }
    } catch (error) { this.state.status = 'failed'; this.state.error = /signature/.test(error.message) ? '更新签名校验失败' : /incompatible/.test(error.message) ? '此版本与当前程序不兼容' : /hash/.test(error.message) ? '更新文件校验失败' : /startup/.test(error.message) ? '此版本启动失败，已保留上一版' : '更新下载失败，请稍后重试'; }
    return this.state;
  }
  async activate({ idle = false } = {}) {
    if (!idle || !this.pointer.staged) return false;
    const manifest = await this.verifyVersion(this.pointer.staged);
    this.pointer.previous = this.pointer.active; this.pointer.active = this.pointer.staged;
    this.pointer.staged = null; this.pointer.trial = true;
    await this.persist(); this.state.currentVersion = manifest.version; this.state.status = 'starting'; return true;
  }
  async healthy() {
    if (!this.pointer.trial) return;
    await this.verifyVersion(this.pointer.active);
    this.pointer.trial = false; await this.persist(); this.state.status = 'current'; this.state.error = null;
  }
  async rollback(reason = 'startup self-check failed') {
    const failed = this.pointer.active;
    let previous = this.pointer.previous;
    try { if (previous) this.state.currentVersion = (await this.verifyVersion(previous)).version; }
    catch { previous = null; }
    if (!previous) this.state.currentVersion = this.builtInVersion;
    if (failed && !this.pointer.rejected.includes(failed)) this.pointer.rejected.push(failed);
    Object.assign(this.pointer, { active: previous, previous: null, staged: null, trial: false, lastFailure: { versionId: failed, reason, at: new Date().toISOString() } });
    await this.persist(); this.state.status = 'failed'; this.state.error = '新界面启动失败，已恢复上一版';
  }
  async resource(name) {
    if (!this.pointer.active) return null;
    const manifest = await this.manifest(this.pointer.active);
    const file = manifest.files.find(row => row.path === name);
    return file ? this.bytes(this.directory(this.pointer.active), file) : null;
  }
}
