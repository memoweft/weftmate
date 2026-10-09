import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeBrowserOperations } from '../src/personal-access/native-browser.mjs';
import { personalWebFetchProvider } from '../src/plugins/personal-web-fetch.mjs';
import { snapshotFiles } from '../src/plugins/personal-native-files.mjs';
import { dirname } from 'node:path';

test('native preview retains a full local capture, exact segment recovery and session ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pf2-capture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const text = 'Intro\n\n' + 'relevant paragraph. '.repeat(250) + '\n\n' + 'later precise fact. '.repeat(300);
  let reads = 0;
  const context: any = { root: join(root, 'personal-access'),
    sessionOperations: { executionOwnerForSession: () => 'synthetic-owner' },
    accountState: () => ({sessions:{'session-one':{origin:'personal-remote'},'session-two':{origin:'personal-remote'}}}),
    personalExecutionSource: () => ({root:{commandId:'cmd-one'}}),
    browserReader: {read: async () => {reads++; return {capturedText:text,url:'https://example.org',title:'Example',links:[],outline:'Intro\nDetails',truncated:true};}} };
  const browser = createNativeBrowserOperations(context);
  const identity = {sessionId:'session-one',receiptId:'r-one',callId:'c-one'};
  const first = await browser.browse({...identity,browserAction:'open',url:'https://example.org'});
  assert.ok(first.text.length <= 4096);
  assert.equal(first.previewTruncated,true);
  const archive = await readFile(first.sourcePath,'utf8');
  assert.ok(archive.endsWith(text));
  assert.ok(first.sourcePath.startsWith(root));
  assert.equal((await snapshotFiles(dirname(dirname(first.sourcePath)))).size,0,'host-owned captures must not become artifact write receipts');
  const recovered = await browser.browse({...identity,browserAction:'read',snapshotId:first.snapshotId,segmentIndex:0});
  assert.ok(recovered.text.length > first.text.length);
  assert.ok(text.startsWith(recovered.text));
  assert.equal(reads,1);
  const targeted = await browser.browse({...identity,browserAction:'read',snapshotId:first.snapshotId,query:'later precise'});
  assert.ok(targeted.excerpts.every((e: any)=>e.text===text.slice(e.charStart,e.charEnd)));
  assert.ok(targeted.text.includes('later precise fact'));
  assert.ok(targeted.excerpts.reduce((sum: number,e:any)=>sum+e.text.length,0)<=4096);
  assert.equal(reads,1);
  await assert.rejects(browser.browse({...identity,sessionId:'session-two',browserAction:'read',snapshotId:first.snapshotId}),{code:'BROWSER_SOURCE_UNVERIFIED'});
  const provider = personalWebFetchProvider({request:async()=>first},()=>({}),()=>({}));
  const fetched = await provider.fetch({url:'https://example.org'});
  assert.equal(fetched.truncated,true);
  assert.ok(fetched.body.content.includes(first.sourcePath));
  assert.match(fetched.body.content,/segmentIndex=0/);
});
