import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertAccountPath, removeAccountPath } from '../src/personal-data/paths.mjs';
import { exportAccountFolder, sha256, EXPORT_EXCLUDED } from '../src/personal-data/export.mjs';
import { scanStatistics } from '../src/personal-data/statistics.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';
import { createDataControls } from '../src/personal-data/index.mjs';
import { utimes } from 'node:fs/promises';

test('account path assertion rejects lexical escape, another account and resolved junction before deletion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-st4-boundary-'));
  try {
    const a = path.join(root, 'A'), b = path.join(root, 'B'); await mkdir(a); await mkdir(b); await writeFile(path.join(b, 'keep'), 'B');
    await assert.rejects(assertAccountPath(a, b), { code: 'DATA_PATH_OUTSIDE_ACCOUNT' });
    await symlink(b, path.join(a, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(removeAccountPath(a, a), { code: 'DATA_PATH_OUTSIDE_ACCOUNT' });
    assert.equal(await readFile(path.join(b, 'keep'), 'utf8'), 'B');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('statistics uses actual per-category logical sizes and remains cancellable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-st4-stat-'));
  try {
    await writeFile(path.join(root, 'one'), Buffer.alloc(1234));
    const rows = await scanStatistics([{ path: root, category: 'conversations' }, { bytes: 50, category: 'memory' }]);
    assert.equal(rows.conversations.bytes, 1234); assert.equal(rows.memory.bytes, 50); assert.equal(rows.files.bytes, 0);
    const controller = new AbortController(); controller.abort(); await assert.rejects(scanStatistics([], controller.signal));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('export publishes complete hashes, lists all exclusions and cancellation leaves no half package', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-st4-export-'));
  try {
    const destination = path.join(root, 'export');
    await exportAccountFolder({ destination, entries: [{ name: 'conversations/one.md', content: 'Synthetic-A' }, { name: 'memory/portable-v4.json', content: { version: 4 } }] });
    const manifestText = await readFile(path.join(destination, 'manifest.json'), 'utf8'), manifest = JSON.parse(manifestText);
    assert.equal(await readFile(path.join(destination, 'manifest.sha256'), 'utf8'), sha256(manifestText));
    for (const row of manifest.files) assert.equal(sha256(await readFile(path.join(destination, row.path))), row.sha256);
    assert.deepEqual(manifest.excluded, EXPORT_EXCLUDED);
    const controller = new AbortController();
    async function* entries() { yield { name: 'conversations/one.md', content: 'one' }; controller.abort(); yield { name: 'conversations/two.md', content: 'two' }; }
    await assert.rejects(exportAccountFolder({ destination: path.join(root, 'cancelled'), entries: entries(), signal: controller.signal }));
    assert.deepEqual(await readdir(root), ['export']);
    await assert.rejects(exportAccountFolder({ destination: path.join(root, 'escape'), entries: [{ name: '../B/keep', content: 'bad' }] }), { code: 'DATA_EXPORT_INVALID_PATH' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real host requires owner permission and desktop confirmation, clears only A, and cold restart stays empty', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-st4-host-'));
  const backend = { getStatus: async () => ({}), listModels: async () => [], preflight: async () => ({}), createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}), readEvents: async () => ({ events: [], hasMore: false }), describeSession: async () => ({ running: false }), deleteSession: async () => ({ deleted: true }) };
  let host;
  try {
    host = await createPersonalAccessService({ root, port: 0, backend }); const { origin } = await host.start();
    const grant = await host.issueSetupGrant();
    async function request(route, method = 'GET', body, credentials) {
      const response = await fetch(origin + '/personal/v1' + route, { method, headers: { origin, ...(body ? { 'content-type':'application/json' } : {}), ...credentials }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, value: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    const a = await request('/auth/setup', 'POST', { grant: grant.grant, username: 'Synthetic-A', password: 'synthetic password long enough', deviceName: 'A desktop' });
    assert.equal(a.status, 201, JSON.stringify(a.value));
    const creds = { cookie: a.cookie, 'x-weftmate-csrf': a.value.csrfToken }, desktop = { ...creds, 'x-weftmate-desktop': host.libraryDesktopToken };
    const b = await request('/auth/register', 'POST', { username: 'Synthetic-B', password: 'synthetic password long enough', deviceName: 'B' }); assert.equal(b.status, 201);
    const ownerA = a.value.account.ownerId, ownerB = b.value.account.ownerId;
    await mkdir(path.join(root, 'accounts', ownerA, 'cache'), { recursive: true }); await writeFile(path.join(root, 'accounts', ownerA, 'cache', 'thumb'), 'cache');
    await mkdir(path.join(root, 'accounts', ownerB), { recursive: true }); await writeFile(path.join(root, 'accounts', ownerB, 'keep'), 'B');
    const forbidden = await request('/data/delete', 'POST', { accountName: 'Synthetic-B', confirm: true }, { cookie: b.cookie, 'x-weftmate-csrf': b.value.csrfToken }); assert.equal(forbidden.status, 403);
    const remote = await request('/data/delete', 'POST', { accountName: 'Synthetic-A', confirm: true }, creds); assert.equal(remote.value.operation.state, 'pending_confirmation');
    assert.equal(await readFile(path.join(root, 'accounts', ownerA, 'cache', 'thumb'), 'utf8'), 'cache');
    const refused = await request('/data/confirm', 'POST', { id: remote.value.operation.id, accountName: 'Synthetic-A', confirm: true }, creds); assert.equal(refused.status, 403);
    const confirmed = await request('/data/confirm', 'POST', { id: remote.value.operation.id, accountName: 'Synthetic-A', confirm: true }, desktop); assert.equal(confirmed.status, 202);
    let result;
    for (let i = 0; i < 200; i++) { result = (await request('/data/operations', 'GET', undefined, creds)).value.operation; if (!['running','pending_confirmation'].includes(result.state)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(result.state, 'completed', JSON.stringify(result));
    assert.equal(await readFile(path.join(root, 'accounts', ownerB, 'keep'), 'utf8'), 'B');
    assert.deepEqual((await request('/sessions', 'GET', undefined, creds)).value.sessions, []);
    await host.close(); host = await createPersonalAccessService({ root, port: 0, backend }); await host.start();
    assert.equal(Object.keys(JSON.parse(await readFile(path.join(root, 'store.json'), 'utf8')).accounts[ownerA].sessions).length, 0);
  } finally { await host?.close(); await rm(root, { recursive: true, force: true }); }
});

test('cleanup retains originals, recent logs and unexpired replicas; scans change after cleanup', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-st4-clean-')),owner='owner-A',account=path.join(root,'accounts',owner),now=Date.now();
  const context={root,accountState:()=>({account:{username:'A'},sessions:{},commands:{},devices:{}}),syncRoot:()=>path.join(account,'sync'),backend:{},usage:{exportAccount:()=>({records:[]})},timestamp:()=>now,activity:{record:async()=>{}}};
  try{
    for(const [name,content] of [['sync/attachments/original.image','original'],['sync/attachments/thumbnail.display','cache'],['logs/recent.log','recent'],['logs/old.log','old'],['offline/live.json',JSON.stringify({expiresAt:new Date(now+86400000).toISOString()})],['offline/expired.json',JSON.stringify({expiresAt:new Date(now-86400000).toISOString()})]]){const file=path.join(account,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);if(!name.includes('recent'))await utimes(file,new Date(now-10*86400000),new Date(now-10*86400000));}
    const data=createDataControls(context),before=await data.scan(owner);
    assert.equal(before.categories.find(row=>row.id==='cache').bytes,5);
    assert.equal((await data.clean(owner,'cache',new AbortController().signal)).freedBytes,5);
    await data.clean(owner,'logs',new AbortController().signal);await data.clean(owner,'offline',new AbortController().signal);
    assert.equal(await readFile(path.join(account,'sync/attachments/original.image'),'utf8'),'original');
    assert.equal(await readFile(path.join(account,'logs/recent.log'),'utf8'),'recent');
    assert.ok(await readFile(path.join(account,'offline/live.json')));
    await assert.rejects(readFile(path.join(account,'logs/old.log')),{code:'ENOENT'});await assert.rejects(readFile(path.join(account,'offline/expired.json')),{code:'ENOENT'});
    assert.equal((await data.scan(owner)).categories.find(row=>row.id==='cache').bytes,0);
    await assert.rejects(data.clean(owner,'files',new AbortController().signal),{code:'INVALID_REQUEST'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('account export projection excludes temporary, forgotten sequences and credentials, and preserves original image bytes', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'weftmate-st4-projection-')),owner='A';
  try{
    const state={account:{username:'A',password:{hash:'SECRET_PASSWORD'}},sessions:{normal:{title:'Normal',forgottenSeqs:[2]},temporary:{temporary:true,title:'TEMPORARY_SECRET'}},commands:{},devices:{token:'SECRET_TOKEN'},personalization:{preferredName:'A'},accountModels:{}};
    const context={root,accountState:()=>state,backend:{readEvents:async({sessionId})=>({events:[{seq:1,type:'user.message',data:{text:sessionId==='temporary'?'TEMPORARY_SECRET':'KEEP',attachments:[{id:'sha256:abc',name:'image.png'}]}},{seq:2,type:'user.message',data:{text:'FORGOTTEN_SECRET'}},{seq:3,type:'assistant.message',data:{text:'OK',modelThinking:'SECRET_THINKING'}}],hasMore:false}),readAttachment:async()=>({bytes:Buffer.from('ORIGINAL_IMAGE')})},memoryManager:{enabled:true,portableExport:async()=>({schemaVersion:4,data:{cognitions:[]}})},usage:{exportAccount:()=>({records:[]})},library:{list:async()=>({items:[]})},syncStores:new Map([[owner,{page:()=>({events:[],hasMore:false})}]]),attachmentStores:new Map([[owner,{}]]),syncRoot:()=>path.join(root,'sync')};
    const destination=path.join(root,'export');await exportAccountFolder({destination,entries:createDataControls(context).entries(owner,new AbortController().signal,{})});
    const manifest=JSON.parse(await readFile(path.join(destination,'manifest.json'),'utf8'));assert.ok(manifest.files.some(row=>row.path==='memory/portable-v4.json'));assert.equal(manifest.files.filter(row=>row.path.startsWith('files/attachments')).length,1);
    const contents=(await Promise.all(manifest.files.map(row=>readFile(path.join(destination,row.path),'utf8')))).join('\n');
    for(const secret of ['SECRET_PASSWORD','SECRET_TOKEN','FORGOTTEN_SECRET','TEMPORARY_SECRET','SECRET_THINKING'])assert.equal(contents.includes(secret),false,secret);
    assert.ok(contents.includes('KEEP'));assert.ok(contents.includes('ORIGINAL_IMAGE'));
  }finally{await rm(root,{recursive:true,force:true});}
});

