import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { key, pixels } from './report.mjs';

export async function approveBaseline(root, run, { platform, scene } = {}) {
  root = resolve(root); run = resolve(run);
  await mkdir(root, { recursive:true });
  // Serialize approval with captures; neither can silently change a running comparison.
  const lock = join(root,'nightly.lock'), handle = await open(lock,'wx');
  await handle.writeFile(JSON.stringify({ action:'approve-baseline', pid:process.pid })); await handle.close();
  let committed = false;
  const copied = [], directory = join(root,'approved-baseline');
  try {
    const status = JSON.parse(await readFile(join(run,'nightly-status.json'),'utf8'));
    const manifest = JSON.parse(await readFile(join(run,'gallery/manifest.json'),'utf8'));
    const selected = manifest.records.filter(r => r.file && r.status !== 'failed' && (!platform || r.platform === platform) && (!scene || r.scene === scene));
    if (!selected.length) throw Error('没有可认可的实拍格');
    await mkdir(directory,{recursive:true});
    let old = {records:[]};
    try { old = JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const records = new Map(old.records.map(r => [key(r),r]));
    for (const row of selected) {
      if (!row.synthetic || row.commit !== status.commit) throw Error('只能认可本轮提交的合成实拍格');
      const source = resolve(run,'gallery',row.file);
      if (!source.startsWith(resolve(run,'gallery')+sep)) throw Error('图片路径不在审稿目录内');
      pixels(await readFile(source));
      const file = `${row.platform}-${row.scene}-${row.theme}-${randomUUID()}.png`;
      await copyFile(source,join(directory,file)); copied.push(file);
      records.set(key(row), { platform:row.platform, scene:row.scene, theme:row.theme, file, commit:row.commit, generatedAt:row.generatedAt });
    }
    const temporary = join(directory,'manifest-'+randomUUID()+'.json');
    await writeFile(temporary,JSON.stringify({ approvedAt:new Date().toISOString(), sourceCommit:status.commit, records:[...records.values()] },null,2)+'\n');
    await rename(temporary,join(directory,'manifest.json'));
    committed = true;
    // Delete only replaced baseline images, after the manifest atomically points at new copies.
    const retained = new Set([...records.values()].map(r=>r.file));
    for (const row of old.records) if (!retained.has(row.file)) await rm(join(directory,row.file),{force:true});
    return { approved:selected.length, total:records.size, commit:status.commit };
  } catch (error) {
    for (const file of committed ? [] : copied) await rm(join(directory,file),{force:true});
    throw error;
  } finally { await rm(lock,{force:true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = name => { const i=process.argv.indexOf(name); return i<0?undefined:process.argv[i+1]; };
  if (!value('--reports') || !value('--run')) throw Error('Usage: node scripts/nightly/approve-baseline.mjs --reports <报告根目录> --run <已审阅批次> [--platform mobile-web] [--scene outputs-sources]');
  console.log(JSON.stringify(await approveBaseline(value('--reports'),value('--run'),{platform:value('--platform'),scene:value('--scene')})));
}
