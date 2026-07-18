import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const product = await readFile(new URL('../docs/PRODUCT.md', import.meta.url), 'utf8');
const site = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');

test('WeftMate 保持专有授权，MemoWeft 保持独立公开依赖', () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'UNLICENSED');
  assert.equal(packageJson.dependencies.memoweft, '0.5.1');
  assert.equal(packageLock.packages[''].license, 'UNLICENSED');
  assert.equal(packageLock.packages[''].dependencies.memoweft, '0.5.1');
  assert.doesNotMatch(packageJson.dependencies.memoweft, /^file:/);

  assert.match(license, /WeftMate Proprietary License \/ All Rights Reserved/);
  assert.match(license, /does not\s+cover MemoWeft or any third-party component/);
  assert.match(license, /do not retroactively change the authorization/);

  assert.match(readme, /基于开源 MemoWeft 构建的专有 AI 桌面伴侣/);
  assert.match(product, /MemoWeft 的开源属性不延伸到 WeftMate/);
  assert.doesNotMatch(readme, /WeftMate is an open-source|MIT · 开源|越用越了解你的开源 AI 桌面伴侣/);
  assert.doesNotMatch(site, /github\.com\/memoweft\/weftmate|开源桌面伴侣|核心永远免费开源|开源可审计/);
});
