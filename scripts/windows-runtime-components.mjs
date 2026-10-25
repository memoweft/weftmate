import { mkdir, readdir, readFile, writeFile, lstat, rename, rm } from 'node:fs/promises';
import { join, relative, toNamespacedPath } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeComponentRelative } from '../src/runtime-components.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nsisPath = value => toNamespacedPath(value).replaceAll('$', '$$');

async function inventory(root) {
  const files = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name), info = await lstat(file);
      if (info.isSymbolicLink()) throw Error('Runtime components must contain physical files');
      if (info.isDirectory()) await visit(file);
      else if (info.isFile()) {
        const path = relative(root, file).replaceAll('\\', '/');
        let bytes = await readFile(file);
        if (path === 'VENDOR-MANIFEST.json') {
          // A rebuilt vendor carries a new timestamp even when its runtime did not change.
          const { generatedAt, ...manifest } = JSON.parse(bytes.toString('utf8'));
          bytes = Buffer.from(JSON.stringify(manifest));
        }
        files.push([path, bytes.length, digest(bytes)]);
      }
      else if (!info.isFile()) throw Error('Unsupported runtime component entry');
    }
  }
  if ((await lstat(root)).isSymbolicLink()) throw Error('Runtime component root must be physical');
  await visit(root);
  if (!files.length) throw Error('Runtime component is empty');
  return files;
}

/** Keep the large components outside the shell archive and its uninstall tree. */
export async function prepareWindowsRuntimeComponents(context, out = join(context.packager.projectDir, '.local/installer-ui')) {
  const resources = join(context.appOutDir, 'resources'), root = context.appOutDir + '.components';
  const components = {}, owner = context.packager.config.appId;
  await mkdir(root, { recursive: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(root, '.weftmate-components'), owner);
  const commands = []; let bytes = 0;
  for (const name of ['dsh-runtime', 'memory-runtime']) {
    const source = join(resources, name), files = await inventory(source), version = digest(JSON.stringify(files));
    bytes += files.reduce((sum, file) => sum + file[1], 0);
    const component = runtimeComponentRelative(name, version), destination = join(root, component);
    await mkdir(join(destination, '..'), { recursive: true });
    if (await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) {
      if (digest(JSON.stringify(await inventory(destination))) !== version) throw Error('Existing build runtime component is damaged');
      await rm(source, { recursive: true });
    } else await rename(source, destination);
    components[name] = version;
    const target = `$INSTDIR.components\\${component.replaceAll('/', '\\')}`;
    commands.push(`  System::Call '$PLUGINSDIR\\WeftInstaller.dll::ComponentReady(w "${target}", w "${version}") i.r0'`,
      '  ${If} $0 != 1',
      `    System::Call '$PLUGINSDIR\\WeftInstaller.dll::PrepareComponent(w "${target}", w "${version}") i.r0'`,
      '    ${If} $0 != 1',
      '      !insertmacro WeftFail 2 "COMPONENT_DIRECTORY_UNAVAILABLE: runtime version directory is unavailable"',
      '    ${EndIf}',
      '    ClearErrors',
      `    SetOutPath "${target}"`,
      `    File /r "${nsisPath(destination)}\\*.*"`,
      '    ${If} ${Errors}',
      '      !insertmacro WeftFail 2 "COMPONENT_INSTALL_FAILED: runtime files could not be installed"',
      '    ${EndIf}',
      `    System::Call '$PLUGINSDIR\\WeftInstaller.dll::CompleteComponent(w "${target}", w "${version}") i.r0'`,
      '    ${If} $0 != 1',
      '      !insertmacro WeftFail 2 "COMPONENT_INSTALL_FAILED: runtime installation did not finish"',
      '    ${EndIf}',
      '  ${EndIf}');
  }
  await writeFile(join(resources, 'runtime-components.json'), JSON.stringify({ schemaVersion: 1, components }) + '\n');
  await writeFile(join(out, 'runtime-components.nsh'), [
    `!define WEFT_RUNTIME_COMPONENT_KB ${Math.ceil(bytes / 1024)}`,
    '!macro WeftInstallRuntimeComponents',
    '  System::Call \'$PLUGINSDIR\\WeftInstaller.dll::PrepareComponents(w "$INSTDIR.components", w "${APP_ID}") i.r0\'',
    '  ${If} $0 != 1',
    '    !insertmacro WeftFail 2 "COMPONENT_DIRECTORY_UNAVAILABLE: runtime directory is unavailable"',
    '  ${EndIf}', ...commands, '  SetOutPath $INSTDIR', '!macroend', '',
  ].join('\n'));
  return { root, components };
}
