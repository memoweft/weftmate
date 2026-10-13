import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectProjectRoot, listProjectFiles, readProjectFile } from '../src/personal-projects/index.mjs';
import { folderWarning } from '../src/personal-projects/folder-choice.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { randomUUID } from 'node:crypto';

test('macOS project reader holds volume/inode identity and reads bounded Unicode pages', { skip: process.platform !== 'darwin' }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-mac-project-')));
  try {
    mkdirSync(join(root, 'notes'));
    const content = '合成项目的第一行\n' + '第二行\n'.repeat(8000);
    writeFileSync(join(root, 'notes', 'brief.md'), content);
    const project = await inspectProjectRoot(root), list = await listProjectFiles(project, 'BRIEF');
    assert.equal(project.rootFinalPath, root);
    assert.match(project.rootIdentity, /^[A-F0-9]{8}:[A-F0-9]{16}$/);
    assert.equal(list.files.length, 1);
    assert.equal(list.files[0].relativePath, 'notes/brief.md');
    const first = await readProjectFile(project, list.files[0]);
    assert.ok(first.hasMore);
    assert.ok(Buffer.byteLength(first.text) <= 32 * 1024);
    assert.equal(first.fileSha256, createHash('sha256').update(content).digest('hex'));
    const next = await readProjectFile(project, list.files[0], first.lineEnd + 1);
    assert.equal(next.lineStart, first.lineEnd + 1);
    assert.equal(next.fileSha256, first.fileSha256);
    assert.match(folderWarning('/', '/Users/<user>'), /整盘/);
    assert.match(folderWarning('/Users/<user>', '/Users/<user>'), /私人/);
    assert.match(folderWarning('/System/Library', '/Users/<user>'), /系统/);
    assert.equal(folderWarning(root), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('macOS project registration persists through the real access store and reload', { skip: process.platform !== 'darwin' }, async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-mac-access-'))), root = join(base, 'profile'), project = join(base, 'project');
  mkdirSync(project); writeFileSync(join(project, 'brief.md'), 'synthetic project');
  const backend = Object.fromEntries(['getStatus', 'listModels', 'preflight', 'createSession', 'sendMessage', 'cancelSession', 'readEvents', 'describeSession'].map(name => [name, async () => ({})]));
  let service = await createPersonalAccessService({ root, port: 0, backend });
  try {
    let { origin } = await service.start();
    const call = async (route: string, body?: any, auth = {}) => {
      const response = await fetch(origin + '/personal/v1' + route, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...auth }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const grant = await service.issueSetupGrant(), password = randomUUID() + randomUUID();
    assert.equal((await call('/auth/setup', { grant: grant.grant, username: 'synthetic-mac', password, deviceName: 'synthetic-mac' })).status, 201);
    const login = await call('/auth/login', { username: 'synthetic-mac', password, deviceName: 'synthetic-mac' });
    assert.equal(login.status, 200);
    const auth = { cookie: login.cookie, 'x-weftmate-csrf': login.body.csrfToken };
    const registered = await call('/projects', { requestId: randomUUID(), name: '合成项目', rootPath: project, permission: 'write' }, auth);
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const id = registered.body.project.projectId;
    await service.close(); service = await createPersonalAccessService({ root, port: 0, backend });
    ({ origin } = await service.start());
    const listed = await call('/projects', undefined, auth);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.projects.some((p: any) => p.projectId === id));
  } finally { await service.close(); rmSync(base, { recursive: true, force: true }); }
});

test('macOS project reader rejects changed roots/files, links, path escapes and invalid UTF-8', { skip: process.platform !== 'darwin' }, async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'weftmate-mac-unsafe-'))), root = join(base, 'project');
  mkdirSync(root);
  try {
    writeFileSync(join(root, 'brief.txt'), 'old synthetic bytes');
    writeFileSync(join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    writeFileSync(join(root, 'long.md'), 'a'.repeat(32769));
    writeFileSync(join(base, 'outside.txt'), 'never read this');
    symlinkSync(join(base, 'outside.txt'), join(root, 'link.txt'));
    symlinkSync(base, join(root, 'directory-link'));
    linkSync(join(base, 'outside.txt'), join(root, 'hardlink.txt'));
    const project = await inspectProjectRoot(root), list = await listProjectFiles(project);
    assert.deepEqual(list.files.map((f: any) => f.relativePath).sort(), ['brief.txt', 'invalid.txt', 'long.md']);
    assert.ok(list.skippedCount >= 3);
    const file = list.files.find((f: any) => f.relativePath === 'brief.txt');
    await assert.rejects(readProjectFile(project, { ...file, relativePath: '../outside.txt' }), /PROJECT_UNSAFE_PATH/);
    await assert.rejects(readProjectFile(project, list.files.find((f: any) => f.relativePath === 'invalid.txt')), /PROJECT_INVALID_UTF8/);
    await assert.rejects(readProjectFile(project, list.files.find((f: any) => f.relativePath === 'long.md')), /PROJECT_LINE_TOO_LONG/);
    writeFileSync(join(root, 'brief.txt'), 'changed synthetic bytes');
    await assert.rejects(readProjectFile(project, file), /PROJECT_FILE_CHANGED/);
    renameSync(root, join(base, 'previous'));
    mkdirSync(root);
    await assert.rejects(listProjectFiles(project), /PROJECT_ROOT_CHANGED/);
    symlinkSync(join(base, 'previous'), join(base, 'root-link'));
    await assert.rejects(inspectProjectRoot(join(base, 'root-link')), /PROJECT_/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
