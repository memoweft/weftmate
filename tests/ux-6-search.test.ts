import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fixture as timelineFixture} from './helpers/chat-timeline-fixture.mjs';
import {createChatOperations} from '../src/personal-access/chats.mjs';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const plain=(value:any)=>JSON.parse(JSON.stringify(value));
test('UX-6b dates use account calendar days and preserve complete cross-year dates',()=>{
  const context:any={};runInNewContext(readFileSync('src/personal-access-ui/components/search-view.js','utf8'),context);
  const format=context.WeftSearchView.formatDate,now=new Date('2026-10-10T06:05:00Z');
  assert.equal(format('2026-10-10T06:05:00Z','Asia/Shanghai',now),'今天 14:05');
  assert.equal(format('2026-10-09T15:59:00Z','Asia/Shanghai',now),'昨天');
  assert.equal(format('2026-10-08T06:05:00Z','Asia/Shanghai',now),'10月8日');
  assert.equal(format('2027-01-03T06:05:00Z','Asia/Shanghai',now),'2027年1月3日');
  assert.equal(format('2026-10-10T06:05:00Z','America/Los_Angeles',now),'今天 23:05');
  assert.equal(format('2026-12-31T20:00:00Z','Asia/Shanghai',new Date('2027-01-02T06:00:00Z')),'昨天');
  assert.equal(format('待审批','Asia/Shanghai',now),'待审批');
});
function fixture(read:(path:string)=>any=async()=>({items:[],projects:[]})){
  const context:any={URLSearchParams,setTimeout,clearTimeout,WeftUiCore:{factories:{}}};runInNewContext(readFileSync('src/ui-core/search.js','utf8'),context);
  const values=new Map<string,string>(),core:any={state:{ownerId:'owner',identityGeneration:0},accessApi:read,memoryRequest:read};
  Object.assign(core,context.WeftUiCore.factories.search(core,{}, {storage:{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)}}));
  return {core,api:context.WeftUiCore,values};
}
test('UX-6 merges stable identities, title matches first, attention and recent order; excludes private/deleted content',()=>{
  const f=fixture(),rows=f.api.mergeSearchRows([{key:'b',at:'2026-01-01',match:'content'},{key:'a',at:'2025-01-01',match:'title'},
    {key:'b',at:'2026-02-01',match:'content'},{key:'c',attention:true},{key:'t',temporary:true},{key:'mixed',hasTemporaryContent:true},{key:'off',memoryMode:'off'},{key:'gone',deleted:true},{key:'forgot',forgotten:true}]);
  assert.deepEqual(plain(rows).map((row:any)=>row.key),['c','a','b']);
});
test('UX-6 debounce issues only the final query and late response cannot replace it',async()=>{
  let resolveOld:any;const requests:string[]=[];
  const f=fixture(async path=>{requests.push(path);if(path.includes('q=old'))return new Promise(resolve=>resolveOld=resolve);return {items:path.includes('q=new')?[{chatId:'new',title:'new'}]:[],projects:[]};});
  await f.core.openSearch();await f.core.typeSearch('chats');f.core.querySearch('old');await wait(180);f.core.querySearch('unused');f.core.querySearch('new');await wait(180);
  assert.equal(f.core.search.rows[0].id,'new');resolveOld({items:[{chatId:'old',title:'old'}]});await wait(10);assert.equal(f.core.search.rows[0].id,'new');assert.ok(!requests.some(path=>path.includes('unused')));f.core.closeSearch();
});
test('UX-6 account switch and close discard in-flight replies; recent persistence stores identifiers only',async()=>{
  let resolve:any;const f=fixture(async path=>path.includes('scope=search')?new Promise(done=>resolve=done):{items:[],projects:[]});
  const pending=f.core.openSearch();f.core.state.identityGeneration++;f.core.state.ownerId='other';resolve({items:[{chatId:'private',title:'previous account'}]});await pending;assert.equal(f.core.search.rows.length,0);
  f.core.rememberSearch({type:'chats',id:'safe',title:'private words'});assert.ok([...f.values.values()].every(value=>!value.includes('private words')));
  const closing=f.core.openSearch();f.core.closeSearch();resolve({items:[{chatId:'late',title:'late'}]});await closing;assert.equal(f.core.search.rows.length,0);
});
test('UX-6 keyboard wraps rows/types, home/end select bounds, Esc closes, operation items have correct destinations',async()=>{
  const f=fixture();await f.core.openSearch();assert.deepEqual(plain(f.core.searchActions()).map((row:any)=>row.id),['new','temporary','project','settings','memory','activity','goals','library','help','releases','shortcuts']);
  assert.equal(f.core.searchActions('hello')[0].query,'hello');f.core.navigateSearch('ArrowUp');assert.equal(f.core.search.selected,f.core.search.rows.length-1);f.core.navigateSearch('Home');assert.equal(f.core.search.selected,0);
  f.core.navigateSearch('ArrowLeft');assert.equal(f.core.search.type,'memory');await wait(10);f.core.navigateSearch('Escape');assert.equal(f.core.search.open,false);
});
test('UX-6 account search reuses logical index, filters temporary/mixed sources and forgotten sequences, refuses old cursors',async()=>{
  const f:any=timelineFixture(18);f.context.chatTimeline=f.timeline;
  f.context.sessionOperations={describe:async()=>new Map(),summary:async()=>({title:'paper',pinned:false}),activityTime:()=>null};f.context.messageModelUsable=()=>false;
  const chats=createChatOperations(f.context),params=new URLSearchParams({scope:'search',q:'纸船',limit:'1'});
  const page=await chats.list('owner',params);assert.equal(page.items[0].match,'content');assert.ok(page.items[0].eventId);assert.ok(page.nextCursor);
  f.account.sessions['native-0'].forgottenSeqs=[0];f.account.chatIdentity.chats[f.mainId].contentRevision++;f.timeline.invalidate('owner',f.mainId);
  await assert.rejects(()=>chats.list('owner',new URLSearchParams({...Object.fromEntries(params),cursor:page.nextCursor})),{code:'CURSOR_RESET_REQUIRED'});
  const next=await chats.list('owner',new URLSearchParams({scope:'search',q:'纸船',limit:'200'}));assert.ok(!next.items.some(row=>row.sourceRef?.sessionId==='native-0'&&row.sourceRef.seq===0));
  f.account.sessions['native-0'].hasTemporaryContent=true;assert.equal((await chats.list('owner',params)).items.length,0);
  await assert.rejects(()=>chats.list('other',params),{code:'CHAT_UNAVAILABLE'});await f.timeline.close();
});
test('UX-6 invalid search parameters are rejected, deletion during reading does not resurrect a result',async()=>{
  const f:any=timelineFixture(18);f.context.chatTimeline=f.timeline;f.context.sessionOperations={describe:async()=>new Map(),summary:async()=>({title:'paper'}),activityTime:()=>null};f.context.messageModelUsable=()=>false;
  const chats=createChatOperations(f.context);await assert.rejects(()=>chats.list('owner',new URLSearchParams({scope:'search',q:'a'.repeat(121)})),{code:'INVALID_REQUEST'});
  let release:any;const read=f.context.backend.readEvents;f.context.backend.readEvents=async(input:any)=>{await new Promise(resolve=>release=resolve);return read(input);};
  const pending=chats.list('owner',new URLSearchParams({scope:'search',q:'纸船'}));while(!release)await wait(1);
  f.account.activity={generation:1};f.timeline.invalidate('owner',f.mainId);release();await assert.rejects(()=>pending,{code:'CURSOR_RESET_REQUIRED'});await f.timeline.close();
});

test('UX-6 an account switch during side creation cannot fill or send the old search phrase',async()=>{
  let options:any,release:any;const noop=()=>{},node=()=>({append:noop,prepend:noop,setAttribute:noop,focus:noop,value:'新账号草稿'}),nodes=new Map<string,any>(),sent:string[]=[];
  const context:any={WeftUiComponents:{factories:{}},weftmateDesktop:{},WeftIcons:{create:node},WeftSearchView:{mount:(value:any)=>{options=value;return {};}}};
  runInNewContext(readFileSync('src/personal-access-ui/components/search.js','utf8'),context);
  const core:any={state:{ownerId:'owner-a',identityGeneration:1,sessions:[]},selectSession:noop,selectMainChat:noop,
    startNewConversation:()=>new Promise(done=>release=done),sendDraft:async(text:string)=>sent.push(text)};
  const ui:any={resetIdentityControls:noop,toast:noop,element:node,updateAvailability:noop,byId:(id:string)=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}};
  context.WeftUiComponents.factories.search(core,ui).mountSearch();const work=options.open({type:'actions',id:'start',query:'旧账号的搜索句'});
  core.state.ownerId='owner-b';core.state.identityGeneration++;release();await work;assert.deepEqual(sent,[]);assert.equal(nodes.get('message-text')?.value??'新账号草稿','新账号草稿');
});
