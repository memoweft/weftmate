import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { catalog, repository, assertPublicText } from './common.mjs';
// Explicit compatibility aliases for known synthetic device captures. Browser captures
// and UI-3's machine-path-bearing shell evidence are deliberately not device evidence.
const aliases = [];
const add = (platform, directory, prefix, mapping, themes) => {
  for (const theme of themes) for (const [scene, suffix] of Object.entries(mapping)) {
    aliases.push({ platform, scene, theme, path: `${directory}/${prefix.replace('{theme}', theme)}${suffix}.png` });
  }
};
add('iphone', 'apps/apple/Tests/Evidence/DS-1b', 'after-{theme}-', { sessions: 'list', conversation: 'running', approval: 'approval', 'outputs-sources': 'outputs-sources' }, ['light', 'dark']);
add('iphone', 'apps/apple/Tests/Evidence/IC-2', 'ios-{theme}-', { sessions: 'sidebar', conversation: 'completed-composer', approval: 'approval-composer', 'outputs-sources': 'outputs-sources' }, ['light', 'dark']);
add('android', 'tests/evidence/fe-1b', 'after-mumu-', { login: 'login', sessions: 'list', conversation: 'steps', approval: 'approval', 'outputs-sources': 'outputs-sources', memory: 'memory' }, ['light']);
aliases.push({ platform: 'android', scene: 'sessions', theme: 'dark', path: 'tests/evidence/fe-1b/after-mumu-dark-list.png' },
  { platform: 'android', scene: 'appearance', theme: 'dark', path: 'tests/evidence/fe-1b/after-mumu-appearance.png' });
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
async function walk(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path)); else result.push(path);
  }
  return result;
}
export async function collectEvidence(captureDirectory) {
  const candidates = [];
  const failures = [];
  for (const name of await readdir(captureDirectory).catch(() => [])) {
    if (!/^review-(windows|mobile-web)-.+-(light|dark)\.json$/.test(name)) continue;
    const row = JSON.parse(await readFile(join(captureDirectory, name), 'utf8'));
    if (row.status !== 'failed') continue;
    if (name !== `review-${row.platform}-${row.scene}-${row.theme}.json` || !catalog.scenes.some(scene => scene.id === row.scene) || !catalog.themes.includes(row.theme) || row.synthetic !== true || !/^[a-f0-9]{40}$/.test(row.commit) || !Number.isFinite(Date.parse(row.generatedAt)) || typeof row.reason !== 'string' || !row.reason.trim()) throw Error('Invalid capture failure provenance');
    assertPublicText(JSON.stringify(row)); failures.push(row);
  }
  const roots = [captureDirectory, join(repository, 'tests/evidence'), join(repository, 'apps/apple/Tests/Evidence')];
  const pattern = /^review-(windows|mobile-web|android|iphone|mac|watch)-(.+)-(light|dark)(?:-\d{8}T\d{6}Z)?\.png$/;
  for (const root of roots) for (const path of await walk(root)) {
    const match = path.split(/[\\/]/).at(-1).match(pattern);
    if (!match || !catalog.scenes.some(row => row.id === match[2])) continue;
    const metadata = JSON.parse(await readFile(path.replace(/\.png$/, '.json'), 'utf8'));
    assertPublicText(JSON.stringify(metadata));
    if (metadata.synthetic !== true || !/^[a-f0-9]{40}$/.test(metadata.commit) || !Number.isFinite(Date.parse(metadata.generatedAt))) throw Error('Device evidence needs synthetic provenance, full commit and ISO timestamp');
    if (metadata.platform !== match[1] || metadata.scene !== match[2] || metadata.theme !== match[3]) throw Error('Evidence metadata disagrees with filename');
    candidates.push({ ...metadata, path, source: roots.indexOf(root) === 0 ? metadata.source : relative(repository, path).replaceAll('\\', '/') });
  }
  for (const row of aliases) {
    const path = join(repository, row.path);
    try { await readFile(path); } catch { continue; }
    const history = git(['log', '-1', '--format=%H|%cI', '--', row.path]);
    if (!history) continue;
    const [commit, generatedAt] = history.split('|');
    candidates.push({ ...row, path, commit, generatedAt, synthetic: true, source: row.path, timeBasis: '证据提交时间（历史图未记录拍摄时间）' });
  }
  return catalog.scenes.flatMap(scene => catalog.platforms.flatMap(platform => catalog.themes.map(theme => {
    const matches = candidates.filter(row => row.scene === scene.id && row.platform === platform.id && row.theme === theme)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt) || a.source.localeCompare(b.source));
    return failures.find(row => row.scene === scene.id && row.platform === platform.id && row.theme === theme) || matches[0] || { scene: scene.id, platform: platform.id, theme, status: scene.unavailable?.includes(platform.id) ? '此端尚无' : '待补' };
  })));
}
