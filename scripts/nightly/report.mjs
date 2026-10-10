import { readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { catalog } from '../review-gallery/common.mjs';
import { collectEvidence } from '../review-gallery/evidence.mjs';

export const key = row => `${row.platform}/${row.scene}/${row.theme}`;
// Decode actual PNG pixels (not compressed-byte differences). Native screenshots
// and Chromium/Electron emit non-interlaced 8-bit PNG; other formats fail visibly.
export function pixels(png) {
  if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('Invalid PNG');
  let width, height, channels, palette, alpha, data = [];
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), name = png.toString('ascii', p + 4, p + 8), bytes = png.subarray(p + 8, p + 8 + n);
    if (name === 'IHDR') {
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[9]];
      if (bytes[8] !== 8 || bytes[12] !== 0 || !channels) throw Error('Unsupported PNG pixel format');
    }
    if (name === 'PLTE') palette = bytes;
    if (name === 'tRNS') alpha = bytes;
    if (name === 'IDAT') data.push(bytes);
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, decoded = Buffer.alloc(height * stride);
  if (raw.length !== height * (stride + 1)) throw Error('Invalid PNG scanlines');
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[y * stride + x - channels] : 0;
      const b = y ? decoded[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      decoded[y * stride + x] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels, target = i * 4;
    if (palette) { const index = decoded[offset]; rgba[target] = palette[index * 3]; rgba[target + 1] = palette[index * 3 + 1]; rgba[target + 2] = palette[index * 3 + 2]; rgba[target + 3] = alpha?.[index] ?? 255; }
    else if (channels < 3) { rgba.fill(decoded[offset], target, target + 3); rgba[target + 3] = channels === 2 ? decoded[offset + 1] : 255; }
    else { decoded.copy(rgba, target, offset, offset + 3); rgba[target + 3] = channels === 4 ? decoded[offset + 3] : 255; }
  }
  return { width, height, rgba };
}
export function difference(current, previous, tolerance = 24) {
  const a = pixels(current), b = pixels(previous);
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, dimensionsChanged: true };
  let changed = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if ([0, 1, 2, 3].some(c => Math.abs(a.rgba[i + c] - b.rgba[i + c]) > tolerance)) changed++;
  return { ratio: changed / (a.width * a.height), dimensionsChanged: false };
}
export async function inspect(records, { now = Date.now(), threshold = 0.08, baseline = [], baselineDirectory, phases = [], commit } = {}) {
  const alerts = [], differences = [], counts = {};
  for (const platform of catalog.platforms) counts[platform.id] = { expected: 0, captured: 0, unavailable: 0 };
  for (const row of records) {
    const count = counts[row.platform], unavailable = catalog.scenes.find(s => s.id === row.scene).unavailable?.includes(row.platform);
    if (unavailable) { count.unavailable++; continue; }
    count.expected++;
    if (!row.path || row.status === 'failed') { alerts.push({ cell: key(row), kind: row.status === 'failed' ? 'failed' : 'missing', message: row.reason || row.status || '缺图' }); continue; }
    count.captured++;
    const age = now - Date.parse(row.generatedAt);
    if (!Number.isFinite(age) || age > 24 * 3600_000 || age < -60_000) alerts.push({ cell: key(row), kind: 'stale', message: '超过 24 小时未更新或拍摄时间无效' });
    if (commit && row.commit !== commit) alerts.push({ cell: key(row), kind: 'commit', message: '拍摄提交与本轮构建不一致' });
    const old = baseline.find(item => key(item) === key(row));
    if (old?.file && baselineDirectory) {
      try {
        const diff = difference(await readFile(row.path), await readFile(join(baselineDirectory, old.file)));
        differences.push({ cell: key(row), ...diff, previousCommit: old.commit });
        if (diff.ratio > threshold) alerts.push({ cell: key(row), kind: 'diff', message: `像素变化 ${(diff.ratio * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}%` });
      } catch { alerts.push({ cell: key(row), kind: 'diff-error', message: '像素比较失败（PNG 或基线缺失）' }); }
    }
  }
  for (const phase of phases) if (phase.status !== 'passed') alerts.push({ cell: phase.name, kind: phase.status, message: phase.reason || '运行失败' });
  differences.sort((a, b) => b.ratio - a.ratio);
  return { generatedAt: new Date(now).toISOString(), counts, threshold, alerts, differences, phases };
}
export async function previousRun(root, current) {
  const dates = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).map(e => e.name).sort().reverse();
  for (const date of dates) {
    const runs = (await readdir(join(root, date), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
    for (const run of runs) {
      const dir = join(root, date, run, 'gallery');
      if (resolve(dir) === resolve(current)) continue;
      try { const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); return { baseline: manifest.records, baselineDirectory: dir }; } catch {}
    }
  }
  return { baseline: [] };
}
export async function retention(root, now = new Date()) {
  const cutoff = new Date(now); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 13);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const removed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name) || entry.name >= cutoffDate) continue;
    const target = resolve(root, entry.name);
    if (!target.startsWith(resolve(root) + sep) || (await stat(target)).isSymbolicLink()) throw Error('Retention target escaped report root');
    await rm(target, { recursive: true }); removed.push(entry.name);
  }
  return removed;
}
export async function report(out, options) {
  const records = await collectEvidence(join(out, 'gallery'), { includeRepositoryEvidence: false });
  for (const row of records) if (!row.path && !catalog.scenes.find(s => s.id === row.scene).unavailable?.includes(row.platform)) {
    const phase = options.phases.find(p => p.platforms?.includes(row.platform) && p.status !== 'passed');
    if (phase) Object.assign(row, { status: 'failed', reason: phase.reason, synthetic: true, commit: options.commit, generatedAt: new Date().toISOString() });
  }
  const result = await inspect(records, options);
  Object.assign(result, { commit: options.commit, startedAt: options.startedAt, durationSeconds: (Date.now() - Date.parse(options.startedAt)) / 1000, cleanup: options.cleanup, baseline: options.baselineDirectory ? 'previous local run' : '首次运行：无像素基线' });
  await writeFile(join(out, 'nightly-status.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(out, 'outcomes.json'), JSON.stringify(records.map(({ path, ...row }) => row), null, 2));
  const lines = ['# WeftMate 夜间回归报告', '', `提交：\`${options.commit}\``, `开始：${options.startedAt}`, `结束：${result.generatedAt}`, `耗时：${result.durationSeconds.toFixed(1)} 秒`, '', `结果：${result.alerts.length ? `报警（${result.alerts.length} 项）` : '通过'}`, '[打开本轮审稿页](gallery/index.html)', '', '| 端 | 本轮新拍 / 应拍 | 此端尚无 |', '|---|---:|---:|', ...Object.entries(result.counts).map(([p, c]) => `| ${p} | ${c.captured} / ${c.expected} | ${c.unavailable} |`), '', '## 批次', '', '| 批次 | 结果 | 秒 | 原因 |', '|---|---|---:|---|', ...options.phases.map(p => `| ${p.name} | ${p.status} | ${(p.seconds || 0).toFixed(1)} | ${p.reason || ''} |`), '', '## 报警', '', ...(result.alerts.length ? result.alerts.map(a => `- ${a.cell}：${a.kind} · ${a.message}`) : ['无。']), '', '## 差异最大的格', '', `阈值：${(result.threshold * 100).toFixed(2)}%；每个像素任一 RGBA 通道变化超过 24 才计入。尺寸变化计 100%。`, '', ...(result.differences.length ? result.differences.slice(0, 10).map(d => `- ${d.cell}：${(d.ratio * 100).toFixed(2)}%`) : [result.baseline]), '', '## 清理', '', '```json', JSON.stringify(options.cleanup, null, 2), '```', '', '仅合成夹具，无真实模型。没有历史截图补位；此端尚无按共同审稿清单排除。', ''];
  await writeFile(join(out, 'nightly-report.md'), lines.join('\n'));
  return result;
}
