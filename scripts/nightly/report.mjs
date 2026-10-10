import { readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { catalog } from '../review-gallery/common.mjs';
import { collectEvidence } from '../review-gallery/evidence.mjs';
import { vendorTestMarkdown } from './vendor-tests.mjs';

export const key = row => `${row.platform}/${row.scene}/${row.theme}`;
export const expectedPhases = [
  { name:'prepare', platforms:[] }, { name:'vendor-tests', platforms:[] },
  { name:'installed-smoke', platforms:[] }, { name:'windows', platforms:['windows'] },
  { name:'mobile-web', platforms:['mobile-web'] }, { name:'android', platforms:['android'] }, { name:'apple', platforms:[] },
  { name:'mac', platforms:['mac'] }, { name:'iphone', platforms:['iphone'] }, { name:'watch', platforms:['watch'] },
  { name:'cleanup', platforms:[] },
];
export function completePhases(phases = []) {
  const failure = phases.find(p => p.status === 'failed' || p.status === 'environment');
  return [...expectedPhases.map(p => {
    const existing=phases.find(item=>item.name===p.name);
    if(existing) return {...existing, platforms:p.platforms};
    const apple=['mac','iphone','watch'].includes(p.name) && phases.find(item=>item.name==='apple');
    return { ...p, derived:!!apple, status:apple ? apple.status === 'failed' ? 'not-run' : apple.status : 'not-run',
      reason:apple ? apple.reason || '由 Apple 批次执行' : failure ? `前序 ${failure.name} 未完成：${failure.reason || '运行失败'}` : '编排没有执行此阶段' };
  }), ...phases.filter(p => !expectedPhases.some(e => e.name === p.name))];
}
// Decode actual PNG pixels (not compressed-byte differences). Native screenshots
// and Chromium/Electron emit non-interlaced 8-bit PNG; other formats fail visibly.
export function pixels(png) {
  if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('Invalid PNG');
  let width, height, channels, colorType, palette, alpha, data = [];
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), name = png.toString('ascii', p + 4, p + 8), bytes = png.subarray(p + 8, p + 8 + n);
    if (name === 'IHDR') {
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4);
      colorType = bytes[9]; channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
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
    if (colorType === 3) { const index = decoded[offset]; if (!palette) throw Error('PNG palette missing'); rgba[target] = palette[index * 3]; rgba[target + 1] = palette[index * 3 + 1]; rgba[target + 2] = palette[index * 3 + 2]; rgba[target + 3] = alpha?.[index] ?? 255; }
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
    if (row.status === 'not-run') continue;
    if (!row.path || row.status === 'failed') { alerts.push({ cell: key(row), kind: row.status === 'failed' ? 'failed' : 'missing', message: row.reason || row.status || '缺图' }); continue; }
    count.captured++;
    const age = now - Date.parse(row.generatedAt);
    if (!Number.isFinite(age) || age > 24 * 3600_000 || age < -60_000) alerts.push({ cell: key(row), kind: 'stale', message: '超过 24 小时未更新或拍摄时间无效' });
    if (commit && row.commit !== commit) alerts.push({ cell: key(row), kind: 'commit', message: '拍摄提交与本轮构建不一致' });
    const old = baseline.find(item => key(item) === key(row));
    if (old?.file && (old.baselinePath || baselineDirectory)) {
      try {
        const diff = difference(await readFile(row.path), await readFile(old.baselinePath || join(baselineDirectory, old.file)));
        differences.push({ cell: key(row), ...diff, previousCommit: old.commit });
        if (diff.ratio > threshold) alerts.push({ cell: key(row), kind: 'diff', message: `像素变化 ${(diff.ratio * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}%` });
      } catch { alerts.push({ cell: key(row), kind: 'diff-error', message: '像素比较失败（PNG 或基线缺失）' }); }
    }
  }
  for (const phase of phases) if (phase.status !== 'passed' && !phase.derived) alerts.push({ cell: phase.name, kind: phase.status, message: phase.reason || '运行失败' });
  differences.sort((a, b) => b.ratio - a.ratio);
  return { generatedAt: new Date(now).toISOString(), counts, threshold, alerts, differences, phases };
}
export async function previousRun(root, current) {
  const baselineDirectory = join(root, 'approved-baseline');
  try {
    const manifest = JSON.parse(await readFile(join(baselineDirectory, 'manifest.json'), 'utf8'));
    return { baseline: manifest.records.map(row => ({ ...row, baselinePath: join(baselineDirectory,row.file) })), baselineDirectory };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { baseline: [] };
  }
}
export async function retention(root, now = new Date()) {
  const cutoff = new Date(now); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 13);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const removed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name) || entry.name >= cutoffDate) continue;
    const target = resolve(root, entry.name);
    if (!target.startsWith(resolve(root) + sep) || (await lstat(target)).isSymbolicLink()) throw Error('Retention target escaped report root');
    await rm(target, { recursive: true }); removed.push(entry.name);
  }
  return removed;
}
export async function report(out, options) {
  options = { ...options, phases: completePhases(options.phases) };
  const records = await collectEvidence(join(out, 'gallery'), { includeRepositoryEvidence: false });
  for (const phase of options.phases) if (phase.platforms?.length) {
    const applicable = records.filter(r=>phase.platforms.includes(r.platform) && !catalog.scenes.find(s=>s.id===r.scene).unavailable?.includes(r.platform));
    phase.captures = { captured:applicable.filter(r=>r.path && r.status !== 'failed').length, expected:applicable.length, failed:applicable.filter(r=>r.status === 'failed').length };
    if (phase.derived && phase.captures.captured) {
      const interrupted=options.phases.find(p=>p.name==='apple').status === 'failed' && phase.captures.captured < phase.captures.expected;
      Object.assign(phase,{status:interrupted?'failed':'passed', reason:interrupted?phase.reason:''});
    } else if (phase.derived && phase.status === 'passed') Object.assign(phase,{status:'not-run',reason:'Apple 批次未产生此端截图'});
    if (phase.status === 'passed' && phase.captures.failed) Object.assign(phase,{status:'failed',reason:`${phase.captures.failed} 格场景失败，见报警清单`});
  }
  for (const row of records) if (!row.path && row.status !== 'failed' && !catalog.scenes.find(s => s.id === row.scene).unavailable?.includes(row.platform)) {
    const phase = options.phases.find(p => p.platforms?.includes(row.platform));
    if (phase && phase.status !== 'passed') Object.assign(row, { status: 'not-run', reason: phase.reason || '阶段未产生此格截图', synthetic: true, commit: options.commit, generatedAt: new Date().toISOString() });
  }
  const result = await inspect(records, options);
  const summary = { notRunStages: options.phases.filter(p => ['not-run','skipped','environment'].includes(p.status)).length,
    failedStages: options.phases.filter(p => p.status === 'failed').length,
    notRunCells: records.filter(r => !r.path && r.status !== 'failed' && !catalog.scenes.find(s=>s.id===r.scene).unavailable?.includes(r.platform)).length, failedCells: records.filter(r => r.status === 'failed').length };
  Object.assign(result, { summary, bootstrapCommit: options.bootstrapCommit || 'unknown', commit: options.commit, startedAt: options.startedAt, durationSeconds: (Date.now() - Date.parse(options.startedAt)) / 1000, cleanup: options.cleanup, baseline: options.baselineDirectory ? '人工认可基线（不会随夜间运行自动替换）' : '尚未认可像素基线，请审稿后执行 approve-baseline.mjs' });
  await writeFile(join(out, 'nightly-status.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(out, 'outcomes.json'), JSON.stringify(records.map(({ path, ...row }) => row), null, 2));
  const lines = ['# WeftMate 夜间回归报告', '', `引导层提交：\`${result.bootstrapCommit}\`` , `被测提交：\`${options.commit}\``, `开始：${options.startedAt}`, `结束：${result.generatedAt}`, `耗时：${result.durationSeconds.toFixed(1)} 秒`, '', `结果：未运行 ${summary.notRunStages} 阶段 / ${summary.notRunCells} 格；执行后失败 ${summary.failedStages} 阶段 / ${summary.failedCells} 格；${result.alerts.length ? `报警（${result.alerts.length} 项）` : '通过'}`, '[打开本轮审稿页](gallery/index.html)', '', '| 端 | 本轮新拍 / 应拍 | 此端尚无 |', '|---|---:|---:|', ...Object.entries(result.counts).map(([p, c]) => `| ${p} | ${c.captured} / ${c.expected} | ${c.unavailable} |`), '', '## 批次', '', '| 批次 | 结果 | 秒 | 实拍／应拍或检查数 | 原因 |', '|---|---|---:|---:|---|', ...options.phases.map(p => `| ${p.name} | ${['not-run','skipped'].includes(p.status) ? '未运行' : p.status === 'environment' ? '未运行（环境问题）' : p.status} | ${(p.seconds || 0).toFixed(1)} | ${p.captures ? p.captures.captured + ' / ' + p.captures.expected : p.tests ? p.tests.passed + ' 通过 / ' + p.tests.failed + ' 失败 / ' + p.tests.skipped + ' 跳过' : p.checks ? p.checks.length + ' 项' : ''} | ${p.reason || ''} |`), '', '## 报警', '', ...(result.alerts.length ? result.alerts.map(a => `- ${a.cell}：${a.kind} · ${a.message}`) : ['无。']), '', '## 差异最大的格', '', `阈值：${(result.threshold * 100).toFixed(2)}%；每个像素任一 RGBA 通道变化超过 24 才计入。尺寸变化计 100%。`, '', ...(result.differences.length ? result.differences.slice(0, 10).map(d => `- ${d.cell}：${(d.ratio * 100).toFixed(2)}%`) : [result.baseline]), '', '## 清理', '', '```json', JSON.stringify(options.cleanup, null, 2), '```', '', '仅合成夹具，无真实模型。没有历史截图补位；此端尚无按共同审稿清单排除。', ''];
  const installed = options.phases.find(p => p.name === 'installed-smoke');
  lines.push(...vendorTestMarkdown(options.phases), '', '## 安装版冒烟', '',
    installed.checks ? `${installed.status}：完成 ${installed.checks.length} 项检查` : `未运行 / 未完成：${installed.reason || installed.status}`, '');
  await writeFile(join(out, 'nightly-report.md'), lines.join('\n'));
  return result;
}
