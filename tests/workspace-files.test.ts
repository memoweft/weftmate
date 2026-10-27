import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import './helpers/posix-project-fixture.mjs';
import { createPersonalAccessService } from './helpers/personal-access-fixture.mjs';
import { waitForCommand } from './helpers/wait-for-command.mjs';
import { bindConversationWork } from '../src/personal-access/work-and-chat.mjs';
import { diffLines } from '../src/personal-access/workspace-files.mjs';

test('workspace APIs read real Git/files, enforce the conversation grant and save against the read version', { timeout: 90000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-ui04-')), folder = join(root, 'work');
  await mkdir(folder); const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args], { windowsHide: true, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'synthetic@example.invalid'); git('config', 'user.name', 'Synthetic'); git('config', 'core.autocrlf', 'false');
  await writeFile(join(folder, 'alpha.txt'), 'old\nkeep\n'); await writeFile(join(folder, 'deleted.txt'), 'bye\n');
  await writeFile(join(folder, 'rename.txt'), 'rename\n'); await mkdir(join(folder, 'nested')); await writeFile(join(folder, 'nested', 'code.js'), 'const answer = 1;\n');
  await mkdir(join(folder, 'removed')); await writeFile(join(folder, 'removed', 'nested.txt'), 'removed directory\n');
  git('add', '.'); git('commit', '-qm', 'fixture'); await rm(join(folder, 'removed'), { recursive: true });
  await writeFile(join(folder, 'alpha.txt'), 'new\nkeep\nmore\n'); await rm(join(folder, 'deleted.txt'));
  git('mv', 'rename.txt', 'renamed.txt'); await writeFile(join(folder, 'new 中文.txt'), 'one\ntwo\n');
  await writeFile(join(folder, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5mQAAAAASUVORK5CYII=', 'base64'));
  await writeFile(join(folder, 'sample.pdf'), '%PDF-1.4\n%%EOF'); await writeFile(join(folder, 'binary.bin'), Buffer.from([0, 1, 2]));
  const sessions = new Set<string>();
  const backend = { getStatus: async () => ({}), listModels: async () => [{ id: 'local', configured: true }], preflight: async () => ({}),
    createSession: async ({ sessionId }: any) => { sessions.add(sessionId); return { sessionId }; },
    describeSession: async (sessionId: string) => sessions.has(sessionId) ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'local' } : null,
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }), sendMessage: async () => ({}), cancelSession: async () => ({}) };
  const service: any = await createPersonalAccessService({ root: join(root, 'host'), port: 0, backend });
  try {
    const { origin, hostId } = await service.start(); await service.__testContext.activity.close();
    let headers: any = { origin, 'content-type': 'application/json' };
    const request = async (route: string, body?: any, auth = true) => {
      const response = await fetch(origin + '/personal/v1' + route, { method: body === undefined ? 'GET' : 'POST',
        headers: auth ? headers : { origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers,
      body: JSON.stringify({ grant: (await service.issueSetupGrant()).grant, username: 'SyntheticFiles', password: 'Synthetic files password', deviceName: 'Synthetic' }) });
    assert.equal(setup.status, 201); headers = { ...headers, cookie: setup.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': (await setup.json()).csrfToken };
    const registered = await request('/projects', { requestId: 'register-files', name: '合成目录', rootPath: folder, permission: 'write' });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const created = await request('/commands', { requestId: 'create-files', kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'local' });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    await waitForCommand(async () => (await request('/commands/' + created.body.command.commandId)).body.command);
    const sid = created.body.command.sessionId, base = `/workspaces/${sid}`;
    assert.equal((await request(base + '/review/status')).body.error.code, 'PROJECT_NOT_SELECTED');
    const ctx = service.__testContext, accountOwner = Object.keys(ctx.rootState.accounts)[0];
    // Bind with the same production operation used when a user chooses a folder.
    await ctx.serial(() => ctx.mutate(accountOwner, (next: any) => bindConversationWork({ ...next, hostId }, sid, registered.body.project.projectId)));
    const status = await request(base + '/review/status'); assert.equal(status.status, 200, JSON.stringify(status.body));
    const alpha = status.body.files.find((file: any) => file.path === 'alpha.txt');
    assert.deepEqual([alpha.status, alpha.additions, alpha.deletions], [' M', 2, 1]);
    assert.equal(status.body.files.find((file: any) => file.path === 'deleted.txt').deletions, 1);
    assert.equal(status.body.files.find((file: any) => file.path === 'new 中文.txt').additions, 2);
    assert.equal(status.body.files.find((file: any) => file.path === 'renamed.txt').oldPath, 'rename.txt');
    const delta = await request(base + '/review/diff', { path: 'alpha.txt' }); assert.equal(delta.status, 200);
    assert.deepEqual(delta.body.lines.filter((line: any) => line.type === 'add').map((line: any) => [line.newLine, line.text]), [[1, 'new'], [3, 'more']]);
    assert.equal((await request(base + '/review/diff', { path: 'deleted.txt' })).body.lines.filter((line: any) => line.type === 'del').length, 1);
    assert.equal((await request(base + '/review/diff', { path: 'removed/nested.txt' })).body.lines.filter((line: any) => line.type === 'del').length, 1);
    assert.equal((await request(base + '/review/diff', { path: 'new 中文.txt' })).body.lines.filter((line: any) => line.type === 'add').length, 2);
    const listing = await request(base + '/files/list', { path: '' }); assert.equal(listing.status, 200);
    assert.ok(listing.body.entries.some((entry: any) => entry.path === 'nested' && entry.type === 'directory'));
    assert.ok(!listing.body.entries.some((entry: any) => entry.name === '.git'));
    assert.equal((await request(base + '/files/list', { path: 'nested' })).body.entries[0].path, 'nested/code.js');
    assert.equal((await request(base + '/files/search', { query: 'CODE' })).body.entries[0].path, 'nested/code.js');
    for (const [file, kind] of [['image.png', 'image'], ['sample.pdf', 'pdf'], ['binary.bin', 'unsupported']]) assert.equal((await request(base + '/files/read', { path: file })).body.kind, kind);
    const read = await request(base + '/files/read', { path: 'alpha.txt' }); assert.equal(read.body.text, 'new\nkeep\nmore\n');
    await writeFile(join(folder, 'alpha.txt'), 'external\n');
    const conflict = await request(base + '/files/save', { path: 'alpha.txt', text: 'draft', version: read.body.version });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'WORKSPACE_FILE_CHANGED'); assert.equal(await readFile(join(folder, 'alpha.txt'), 'utf8'), 'external\n');
    const latest = (await request(base + '/files/read', { path: 'alpha.txt' })).body;
    const saved = await request(base + '/files/save', { path: 'alpha.txt', text: 'saved 中文', version: latest.version });
    assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(await readFile(join(folder, 'alpha.txt'), 'utf8'), 'saved 中文');
    assert.equal((await request(base + '/files/read', { path: 'alpha.txt' })).body.version, saved.body.version);
    const simultaneous = await Promise.all(['first save', 'second save'].map((text, index) => request(base + '/files/save', {
      path: process.platform === 'win32' && index ? 'ALPHA.TXT' : 'alpha.txt', text, version: saved.body.version })));
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409]);
    const currentVersion = (await request(base + '/files/read', { path: 'alpha.txt' })).body.version;
    await t.test('traversal, links, other sessions, anonymous access and read-only grants', async () => {
      for (const unsafe of ['../store.json', 'nested/../../store.json', 'C:/outside.txt', '.git/config', 'nested\\code.js', 'alpha.txt:stream', 'NUL']) {
        assert.equal((await request(base + '/files/read', { path: unsafe })).body.error.code, 'WORKSPACE_UNSAFE_PATH', unsafe);
      }
      const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'outside');
      await symlink(outside, join(folder, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      await link(join(outside, 'secret.txt'), join(folder, 'hardlink.txt'));
      assert.equal((await request(base + '/files/read', { path: 'hardlink.txt' })).body.error.code, 'WORKSPACE_UNSAFE_PATH');
      await rm(join(folder, 'hardlink.txt'));
      assert.equal((await request(base + '/files/read', { path: 'escape/secret.txt' })).body.error.code, 'WORKSPACE_UNSAFE_PATH');
      assert.equal((await request(base + '/files/list', { path: 'escape' })).body.error.code, 'WORKSPACE_UNSAFE_PATH');
      assert.equal((await request(base + '/review/status', undefined, false)).status, 401);
      assert.equal((await request('/workspaces/session-other/review/status')).status, 404);
      await ctx.serial(() => ctx.mutate(accountOwner, (next: any) => { next.projects[registered.body.project.projectId].permission = 'read-only'; }));
      assert.equal((await request(base + '/files/save', { path: 'alpha.txt', text: 'forbidden', version: currentVersion })).body.error.code, 'WORKSPACE_READ_ONLY');
      await rm(join(folder, 'escape')); // Remove our junction before deleting the fixture tree.
    });
    const nestedProject = (await request('/projects', { requestId: 'register-nested', name: '合成子目录', rootPath: join(folder, 'nested'), permission: 'write' })).body.project;
    await ctx.serial(() => ctx.mutate(accountOwner, (next: any) => bindConversationWork({ ...next, hostId }, sid, nestedProject.projectId)));
    await writeFile(join(folder, 'nested', 'code.js'), 'const answer = 2;\n');
    const scoped = await request(base + '/review/status');
    assert.deepEqual(scoped.body.files.map((row: any) => row.path), ['code.js'], 'Git repository ancestor never exposes sibling changes');
    assert.equal((await request(base + '/review/diff', { path: 'code.js' })).body.lines.filter((row: any) => row.type === 'add')[0].text, 'const answer = 2;');
    await ctx.serial(() => ctx.mutate(accountOwner, (next: any) => bindConversationWork({ ...next, hostId }, sid, registered.body.project.projectId)));
    git('add', '.'); git('commit', '-qm', 'clean'); assert.deepEqual((await request(base + '/review/status')).body.files, []);
    await rm(join(folder, '.git'), { recursive: true }); assert.equal((await request(base + '/review/status')).body.error.code, 'WORKSPACE_NOT_GIT');
    git('init', '-q'); assert.ok((await request(base + '/review/status')).body.files.length > 0, 'unborn repository');
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test('structured diff keeps headers, zero ranges, line numbers and no-newline markers', () => {
  assert.deepEqual(diffLines('@@ -0,0 +1,1 @@\n+new\n\\ No newline at end of file\n'), [
    { type: 'hunk', text: '@@ -0,0 +1,1 @@' }, { type: 'add', text: 'new', newLine: 1 }, { type: 'meta', text: '\\ No newline at end of file' }]);
});
