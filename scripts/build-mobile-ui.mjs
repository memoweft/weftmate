/** Publish a reviewed public mobile UI bundle without modifying Android source. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateMobileUiRelease, publishMobileUi } from '../src/personal-access/mobile-ui-release.mjs';
import { checkMobileUi } from '../apps/mobile-ui/src/check.mjs';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(repository, 'apps', 'mobile-ui', 'www');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!name?.startsWith('--') || !value || value.startsWith('--') || options.has(name) ||
      !['--output-dir', '--ui-version', '--min-native-version-code', '--release-notes', '--activate-release', '--channel', '--min-host-version', '--min-native-version'].includes(name)) {
    throw new Error('usage: node scripts/build-mobile-ui.mjs --output-dir <absolute release directory> [--ui-version 0.8.13] [--min-native-version-code 26] [--release-notes text] [--channel stable|preview] [--min-host-version 0.1.0] [--min-native-version 0.8.13] [--activate-release version-hash]');
  }
  options.set(name, value);
}
const outputDir = options.get('--output-dir');
if (!outputDir || !path.isAbsolute(outputDir) ||
    (options.has('--activate-release') && (options.has('--ui-version') ||
      options.has('--release-notes') || options.has('--min-native-version-code')))) {
  throw new Error('an absolute output directory and one publish or activation action are required');
}
if (!options.has('--activate-release')) await checkMobileUi();
const manifest = options.has('--activate-release')
  ? await activateMobileUiRelease({ outputDir, releaseId: options.get('--activate-release') })
  : await publishMobileUi({ sourceDir, outputDir,
    uiVersion: options.get('--ui-version') ?? '0.8.25',
    minNativeVersionCode: Number(options.get('--min-native-version-code') ?? '38'),
    channel: options.get('--channel') ?? 'stable', minHostVersion: options.get('--min-host-version') ?? '0.1.0',
    minNativeVersion: options.get('--min-native-version') ?? '0.0.0',
    releaseNotes: options.get('--release-notes') ?? '' });
console.log(`[mobile-ui] active uiVersion=${manifest.uiVersion} assetBase=${manifest.assetBase}`);
