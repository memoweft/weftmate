import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import * as jose from 'jose';
import { createDirectoryPull, reconcileDirectory } from '../src/personal-cloud/chat-directory.mjs';
import { directoryCodec, directoryPage, applyDirectoryPage, startCursor } from '../src/personal-cloud/directory-wire.mjs';

const date = '2026-01-01T00:00:00.000Z';
const empty = () => ({epoch:'feed',seq:0,rows:[]});
const candidate = (id: string, session = {}) => ({chat:{chatId:id,createdAt:date},session,id});
const row = (id: string, title: string, seq: number) => ({id,title,updatedAt:date,seq});

test('missing native metadata and a pending delete keep the last title until source removal', () => {
  const reconcile = (feed: any, items: any[], native = new Map()) => reconcileDirectory(feed,items,native,() => date);
  const first = reconcile(empty(),[candidate('a'),candidate('b',{title:'archived',archived:true})],new Map([['a',{title:'native',body:'private'}]]));
  assert.deepEqual(first.feed.rows,[row('a','native',1),row('b','archived',2)]);
  const incomplete = reconcile(first.feed,[candidate('a'),candidate('b',{deleting:true})]);
  assert.ok(incomplete.partial);
  assert.deepEqual(incomplete.feed,first.feed);
  const deleted = reconcile(incomplete.feed,[candidate('b',{title:'changed'})]);
  assert.deepEqual(deleted.feed.rows,[{id:'a',deleted:true,seq:4},row('b','changed',3)]);
  assert.deepEqual(reconcile(deleted.feed,[candidate('a',{title:'old snapshot'}),candidate('b',{title:'changed'})]).feed,deleted.feed);
});

test('incremental pages send deletes first and refuse stale challenges, cursors and epochs', () => {
  const feed = {epoch:'a',seq:4,rows:[row('a','one',1),row('b','two',2),{id:'c',deleted:true,seq:3},{id:'d',deleted:true,seq:4}]};
  const cursor = startCursor();
  const page = {...directoryPage(feed,cursor,2),label:'source',requestId:'1'};
  assert.deepEqual(page.rows.map((r:any) => r.id),['c','d']);
  assert.ok(page.more);
  const cache = applyDirectoryPage(null,page,'1');
  assert.throws(() => applyDirectoryPage(cache,page,'1'));
  assert.throws(() => applyDirectoryPage(null,page,'old'));
  const next = {...directoryPage(feed,cache.cursor,2),label:'source',requestId:'2'};
  assert.throws(() => applyDirectoryPage(cache,{...next,epoch:'other'},'2'));
  const complete = applyDirectoryPage(cache,next,'2');
  assert.equal(complete.rows.length,4);
  assert.equal(next.more,false);
  assert.deepEqual(directoryPage(feed,complete.cursor).rows,[]);
  assert.throws(() => directoryPage(empty(),complete.cursor));
});

test('each encrypted directory value is bound to its purpose, account, key and source', async () => {
  const key = randomBytes(32), scope = ['issuer','sub','kid','source'];
  const codec = directoryCodec(jose,key,scope);
  const sealed = await codec.seal('cache',{title:'synthetic title'});
  assert.ok(!sealed.includes('synthetic title'));
  assert.deepEqual(await codec.open('cache',sealed),{title:'synthetic title'});
  await assert.rejects(codec.open('page',sealed));
  for (let i=0;i<scope.length;i++) await assert.rejects(directoryCodec(jose,key,scope.map((s,n) => i===n?'other':s)).open('cache',sealed));
  await assert.rejects(directoryCodec(jose,randomBytes(32),scope).open('cache',sealed));
});

test('publisher excludes main, private history and imported phone rows and rechecks trust after native lookup', async () => {
  const sessions = Object.fromEntries(['normal','private','import'].map(id => [id,id==='private'?{temporary:true}:id==='import'?{phoneHistory:true}:{}]));
  const segments = Object.fromEntries(Object.keys(sessions).map(id => [id,{chatId:id,sessionId:id,hostId:'source'}]));
  const chats = Object.fromEntries(['main',...Object.keys(sessions)].map(id => [id,{chatId:id,kind:id==='main'?'main':'side',activeSegmentId:id,createdAt:date}]));
  let revoked = false, revokeDuringLookup = false;
  const context = {accountState:() => ({sessions,chatIdentity:{version:2,chats,segments}}),serial:(fn:any) => fn(),sessionOperations:{
    describe:async (_owner:string, ids:string[]) => {assert.deepEqual(ids,['normal']);if(revokeDuringLookup)revoked=true;return new Map([['normal',{title:'shown',body:'never returned'}]]);},
    activityTime:() => date,
  }};
  const binding:{directoryBox?:string} = {};
  const codec = directoryCodec(jose,randomBytes(32),['issuer','sub','key','source']);
  const authorize = () => {if(revoked)throw Error('revoked');return {issuer:'issuer',sub:'sub',ownerId:'owner',deviceId:'device',keyId:'key',binding};};
  let writes = 0;
  const pull = createDirectoryPull(context,'source',authorize,(_i:any,_s:any,_h:any,fn:any) => fn(codec),
    (_scope:string,box:string) => {binding.directoryBox=box;writes++;},() => 'test source');
  const query = {deviceId:'device',requestId:'sufficiently-long-id',epoch:null,cursor:startCursor()};
  await assert.rejects(pull({},await codec.seal('pull',{...query,deviceId:'another'})));
  const page = await codec.open('page',(await pull({},await codec.seal('pull',query))).box);
  assert.deepEqual(page.rows,[row('normal','shown',1)]);
  assert.equal(writes,1);
  await pull({},await codec.seal('pull',{...query,epoch:page.epoch,cursor:page.next}));
  assert.equal(writes,1);
  revokeDuringLookup=true;
  await assert.rejects(pull({},await codec.seal('pull',query)),/revoked/);
  assert.equal(writes,1);
});
