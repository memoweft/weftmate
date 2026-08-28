import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const product = await readFile(new URL('../docs/PRODUCT.md', import.meta.url), 'utf8');
const site = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');

test('WeftMate 保持专有授权，外部系统保持独立授权', () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'UNLICENSED');
  // MemoWeft 当前通过试验接缝运行，不作为 package dependency 打入 WeftMate。
  assert.equal(packageJson.dependencies.memoweft, undefined);
  assert.equal(packageLock.packages[''].license, 'UNLICENSED');
  assert.equal(packageLock.packages[''].dependencies.memoweft, undefined);

  assert.match(license, /WeftMate Proprietary License \/ All Rights Reserved/);
  assert.match(license, /does not\s+cover MemoWeft or any third-party component/);
  assert.match(license, /do not retroactively change the authorization/);

  assert.match(readme, /专有的桌面集成中心和图形界面/);
  // 产品授权边界：WeftMate 专有，外部系统保持各自授权。
  assert.match(product, /WeftMate 自有代码、二进制、视觉资产和文档受本仓库 `LICENSE` 专有授权约束/);
  assert.match(product, /DSH 按 MIT 与上游许可证执行/);
  assert.match(product, /WeftMate 不 fork 官方前端/);
  assert.doesNotMatch(readme, /WeftMate is an open-source|MIT · 开源|越用越了解你的开源 AI 桌面伴侣/);
  assert.doesNotMatch(site, /github\.com\/memoweft\/weftmate|开源桌面伴侣|核心永远免费开源|开源可审计/);
});
