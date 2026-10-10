/** Generate mobile assets from the shared feature layer; www/ui-core is never a source. */
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { uiCoreBrowserAssets as uiCoreAssets } from '../../../src/ui-core/manifest.mjs';

export const uiCoreSourceDir = fileURLToPath(new URL('../../../src/ui-core/', import.meta.url));
export const mobileWwwDir = fileURLToPath(new URL('../www/', import.meta.url));
export const mobileUiCoreDir = path.join(mobileWwwDir, 'ui-core');

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`ui-core assets: unsupported generated entry ${relative}`);
  }
  return files;
}

/** Fail before packaging or publishing if the generated set or any bytes are stale. */
export async function checkUiCoreAssets({ sourceDir = uiCoreSourceDir, targetDir = mobileUiCoreDir } = {}) {
  let actual;
  try { actual = await filesUnder(targetDir); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('ui-core assets: generated files are missing; run npm run build in apps/mobile-ui');
  }
  const expected = new Set(uiCoreAssets);
  const found = new Set(actual);
  const problems = [
    ...uiCoreAssets.filter((name) => !found.has(name)).map((name) => `missing ${name}`),
    ...actual.filter((name) => !expected.has(name)).map((name) => `unexpected ${name}`),
  ];
  for (const name of uiCoreAssets) {
    if (!found.has(name)) continue;
    const [source, generated] = await Promise.all([
      readFile(path.join(sourceDir, name)), readFile(path.join(targetDir, name)),
    ]);
    if (!source.equals(generated)) problems.push(`differs ${name}`);
  }
  if (sourceDir === uiCoreSourceDir && targetDir === mobileUiCoreDir) {
    const rendering = JSON.parse(await readFile(new URL('../../../src/personal-access-ui/render-assets.json', import.meta.url), 'utf8'));
    for(const name of rendering){
      const source=await readFile(new URL(`../../../src/personal-access-ui/${name}`,import.meta.url));
      const generated=await readFile(path.join(mobileWwwDir,name));
      if(!source.equals(generated))problems.push(`differs ${name}`);
    }
    for (const name of ['system-bars.js', 'folder-choice.js', 'folder-choice.css', 'components/offline.js', 'offline.css', 'components/notifications.js', 'components/personalization.js', 'personalization.css', 'components/activity-view.js', 'activity.css', 'components/goals-view.js', 'goals.css', 'components/library-view.js', 'library.css', 'components/search-view.js', 'search.css', 'next-suggestions.js', 'next-suggestions.css', 'popovers.js', 'message-actions.js', 'message-actions.css', 'controls.css', 'icons.js', 'rendering.css', 'katex.css']) {
      const source = await readFile(new URL(`../../../src/personal-access-ui/${name}`, import.meta.url));
      const generated = await readFile(path.join(mobileWwwDir, name));
      if (!source.equals(generated)) problems.push(`differs ${name}`);
    }
    for (const [sourceName, generatedName] of [['components/main-chat.js','components/main-chat.js'], ['components/question-bar.js', 'components/question-bar.js'], ['components/usage.js', 'components/usage-view.js'], ['components/settings-controls.js', 'components/settings-controls.js'], ['components/schedules.js', 'components/schedules-view.js'], ['usage.css', 'usage.css'], ['popovers.js', 'popovers.js'], ['conversation-scroll.js', 'conversation-scroll.js']]) {
      const source = await readFile(new URL(`../../../src/personal-access-ui/${sourceName}`, import.meta.url));
      const generated = await readFile(path.join(mobileWwwDir, generatedName));
      if (!source.equals(generated)) problems.push(`differs ${generatedName}`);
    }
    for (const kind of ['terms', 'privacy']) {
      const source = await readFile(new URL(`../../../docs/legal/${kind}-zh.md`, import.meta.url));
      const generated = await readFile(path.join(mobileWwwDir, 'legal', `${kind}-zh.txt`));
      if (!source.equals(generated)) problems.push(`differs legal/${kind}-zh.txt`);
    }
  }
  if (problems.length) throw new Error(`ui-core assets: ${problems.join('; ')}; run npm run build in apps/mobile-ui`);
  return uiCoreAssets.length;
}

export async function buildUiCoreAssets({ sourceDir = uiCoreSourceDir, targetDir = mobileUiCoreDir } = {}) {
  if (sourceDir === uiCoreSourceDir && targetDir === mobileUiCoreDir) {
    const rendering = JSON.parse(await readFile(new URL('../../../src/personal-access-ui/render-assets.json', import.meta.url), 'utf8'));
    for(const name of rendering){await mkdir(path.dirname(path.join(mobileWwwDir,name)),{recursive:true});await copyFile(new URL(`../../../src/personal-access-ui/${name}`,import.meta.url),path.join(mobileWwwDir,name));}
    await copyFile(new URL('../../../src/personal-access-ui/components/main-chat.js', import.meta.url), path.join(mobileWwwDir, 'components/main-chat.js'));
    await copyFile(new URL('../../../src/personal-access-ui/components/question-bar.js', import.meta.url), path.join(mobileWwwDir, 'components/question-bar.js'));
    for (const name of ['system-bars.js', 'folder-choice.js', 'folder-choice.css', 'components/offline.js', 'offline.css', 'components/notifications.js', 'components/personalization.js', 'personalization.css', 'components/activity-view.js', 'activity.css', 'components/goals-view.js', 'goals.css', 'components/library-view.js', 'library.css', 'components/search-view.js', 'search.css', 'popovers.js', 'message-actions.js', 'message-actions.css', 'controls.css', 'icons.js', 'rendering.css', 'katex.css']) await copyFile(new URL(`../../../src/personal-access-ui/${name}`, import.meta.url), path.join(mobileWwwDir, name));
    await copyFile(new URL('../../../src/personal-access-ui/components/usage.js', import.meta.url), path.join(mobileWwwDir, 'components/usage-view.js'));
    await copyFile(new URL('../../../src/personal-access-ui/components/schedules.js', import.meta.url), path.join(mobileWwwDir, 'components/schedules-view.js'));
    await copyFile(new URL('../../../src/personal-access-ui/components/settings-controls.js', import.meta.url), path.join(mobileWwwDir, 'components/settings-controls.js'));
    await copyFile(new URL('../../../src/personal-access-ui/usage.css', import.meta.url), path.join(mobileWwwDir, 'usage.css'));
    for (const name of ['composer-subtasks.js','composer-extras.css','next-suggestions.js','next-suggestions.css']) await copyFile(new URL(`../../../src/personal-access-ui/${name}`, import.meta.url), path.join(mobileWwwDir,name));
    await copyFile(new URL('../../../src/personal-access-ui/popovers.js', import.meta.url), path.join(mobileWwwDir, 'popovers.js'));
    await copyFile(new URL('../../../src/personal-access-ui/conversation-scroll.js', import.meta.url), path.join(mobileWwwDir, 'conversation-scroll.js'));
    await mkdir(path.join(mobileWwwDir, 'legal'), { recursive: true });
    for (const kind of ['terms', 'privacy']) await copyFile(new URL(`../../../docs/legal/${kind}-zh.md`, import.meta.url), path.join(mobileWwwDir, 'legal', `${kind}-zh.txt`));
  }
  await mkdir(targetDir, { recursive: true });
  const expected = new Set(uiCoreAssets);
  for (const name of uiCoreAssets) {
    const destination = path.join(targetDir, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceDir, name), destination);
  }
  // Entries removed from the canonical manifest must also leave the public bundle.
  for (const name of await filesUnder(targetDir)) {
    if (!expected.has(name)) await rm(path.join(targetDir, name));
  }
  return checkUiCoreAssets({ sourceDir, targetDir });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(`[mobile-ui] generated ${await buildUiCoreAssets()} shared ui-core assets`);
}
