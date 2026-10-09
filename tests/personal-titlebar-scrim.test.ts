import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../src/personal-access-ui/native-desktop.js', import.meta.url), 'utf8');
const blend = runInNewContext(source.slice(0, source.indexOf('(() => {')) + '\nblendDesktopColor;');
const tokens = JSON.parse(readFileSync(new URL('../design/tokens/tokens.json', import.meta.url), 'utf8'));

test('native caption background and symbols composite the design scrim in light and dark modes', () => {
  const scrim = tokens.shared.color['desktop-scrim'];
  assert.equal(blend('rgb(255, 255, 255)', scrim), 'rgb(190, 194, 201)');
  assert.equal(blend('rgb(32, 32, 32)', scrim), 'rgb(30, 34, 40)');
  assert.equal(blend('rgb(241, 242, 246)', scrim), 'rgb(180, 185, 194)');
  assert.equal(blend('rgb(32, 32, 32)', 'rgba(0, 0, 0, 0)'), 'rgb(32, 32, 32)');
  assert.equal(blend('rgb(32, 32, 32)', 'rgb(8, 14, 25)'), 'rgb(8, 14, 25)');
  assert.equal(blend('rgb(255, 255, 255)', 'rgba(0, 0, 0, .5)'), 'rgb(128, 128, 128)');
});

test('notification identity matches the build and survives stripped packaged metadata', () => {
  const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const statement = main.split('\n').find(line => line.includes('app.setAppUserModelId('));
  const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const metadata of [packageInfo, { ...packageInfo, build: undefined }]) {
    let id;
    runInNewContext(statement, { process: { platform: 'win32' }, packageInfo: metadata, app: { setAppUserModelId(value) { id = value; } } });
    assert.equal(id, packageInfo.build.appId);
  }
});
