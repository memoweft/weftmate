import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { installPersonalization } from '../src/plugins/personal-personalization.mjs';
import { conversationResources } from '../src/personal-access/resources.mjs';
import '../src/ui-core/personalization.js';
import { DshWebRuntime } from '../src/dsh-web-runtime.ts';
import { browserExtractScript } from '../src/personal-browser/index.mjs';

test('an explicit section anchor captures late original text without raising page bounds or executing the fragment', () => {
  const element=(tagName:string,innerText:string):any=>({tagName,innerText,textContent:innerText,getClientRects:()=>[{}],querySelectorAll:()=>[],nextElementSibling:null});
  const section=element('SECTION','15.4 Redirection\n\nThe user agent MUST NOT change the request method.'),body=element('MAIN','early text '.repeat(30000)+section.innerText);
  body.contains=(value:any)=>value===section;
  const document:any={body,title:'Official specification',querySelector:(q:string)=>q.startsWith('main')?body:null,querySelectorAll:()=>[],getElementById:(id:string)=>id==='section-15.4'?section:null,getElementsByName:()=>[]};
  const env={document,getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const full=runInNewContext(browserExtractScript(),env);assert.equal(full.rawTruncated,true);assert.ok(!full.text.includes('MUST NOT'));
  const focused=runInNewContext(browserExtractScript('section-15.4'),env);assert.equal(focused.text,section.innerText);assert.equal(focused.capturedFragment,'section-15.4');assert.equal(focused.rawTruncated,true);
  assert.equal(runInNewContext(browserExtractScript('";throw new Error("executed");//'),env).capturedFragment,null);
  assert.equal(runInNewContext(browserExtractScript("$' $& $`"),env).capturedFragment,null);
  const heading=element('H3','ABI stability'),paragraph=element('P','Only this API has the guarantee. External dependencies may not.'),next=element('H3','Unrelated section');
  heading.nextElementSibling=paragraph;paragraph.nextElementSibling=next;heading.closest=()=>heading;
  body.contains=()=>true;document.getElementById=()=>heading;
  const portion=runInNewContext(browserExtractScript('abi'),env);assert.equal(portion.text,heading.innerText+'\n\n'+paragraph.innerText);assert.ok(!portion.text.includes('Unrelated'));
});

test('managed-child browser IPC preserves query, exact excerpts, capture time and recovery path', async () => {
  const calls:any[] = [], sent:any[] = [];
  const capture={snapshotId:'capture-one',url:'https://example.org',title:'Official',text:'exact excerpt',
    capturedAt:'2026-10-10T00:00:00Z',sourcePath:'C:/synthetic/conversation/.weftmate-web-sources/capture-one.txt',
    query:'precise',excerpts:[{charStart:7,charEnd:20,text:'exact excerpt'}],previewTruncated:true,secret:'excluded'};
  const runtime:any=new DshWebRuntime({homeDir:'C:/synthetic/dsh',workspaceDir:'C:/synthetic/work',
    personalDesktopRequestHandler:async request=>{calls.push(request);return capture;}});
  const child={connected:true,send:(value:any)=>sent.push(value)};runtime.child=child;
  const frame={protocol:'weftmate.personal-desktop.v1',id:'personal-12345678-1234-1234-1234-123456789abc',
    action:'browse',browserAction:'read',sessionId:'session-safe',turn:1,callId:'call-safe',
    receiptId:'receipt-safe',messageHash:'a'.repeat(64),snapshotId:'capture-one',query:'precise'};
  runtime.handlePersonalDesktopMessage(child,{...frame,query:1});assert.equal(calls.length,0);
  runtime.handlePersonalDesktopMessage(child,frame);
  for(let i=0;i<20&&!sent.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(calls[0].query,'precise');assert.equal(sent[0].ok,true);
  for(const key of ['query','excerpts','sourcePath','capturedAt','previewTruncated'])assert.deepEqual(sent[0].command[key],capture[key]);
  assert.equal(sent[0].command.secret,undefined);
});

test('research self-check defaults on, follows the account turn snapshot, and off retains evidence rules', async () => {
  const hooks:any = {}, agent = {session:{header:{agentPreset:'personal-remote'}}};
  let settings:any = {};
  installPersonalization({on:(name:string,fn:any)=>hooks[name]=fn},async()=>({personalization:settings}));
  const assembly={sections:[{name:'weftmate:research-guidance',text:'Research'}],tools:[]};
  await hooks['agent/pre-step']({agent,turn:1},async()=>{});
  const first=await hooks['system-prompt/assemble'](null,{scope:agent},async()=>assembly);
  const grounded=(value:any)=>value.sections.find((s:any)=>s.name==='weftmate:grounded-writing').text;
  assert.match(grounded(first),/self-check is ON/);
  settings={researchSelfCheck:false};
  assert.match(grounded(await hooks['system-prompt/assemble'](null,{scope:agent},async()=>assembly)),/self-check is ON/);
  await hooks['agent/pre-step']({agent,turn:2},async()=>{});
  const second=await hooks['system-prompt/assemble'](null,{scope:agent},async()=>first);
  assert.match(grounded(second),/self-check is OFF/);
  assert.match(grounded(second),/未在官方资料中确认/);
  assert.equal(second.sections.filter((s:any)=>s.name==='weftmate:grounded-writing').length,1);
  const ordinary=await hooks['system-prompt/assemble'](null,{scope:agent},async()=>({sections:[],tools:[]}));
  assert.equal(ordinary.sections.some((s:any)=>s.name==='weftmate:grounded-writing'),false);
});

test('browser query evidence appears under its actual source URL without exposing raw text in the list', async () => {
  const original='ClangCL is now required to compile Node.js on Windows.';
  const source={url:'https://example.org/release',title:'Official release',capturedAt:'2026-10-10T00:00:00Z',text:original,query:'ClangCL'};
  const raw=JSON.stringify({arguments:JSON.stringify({action:'read',snapshotId:'capture-one',query:'ClangCL'}),
    output:[{type:'tool-result',content:[{type:'text',text:JSON.stringify(source)}]}]});
  const context:any={callBackend:(fn:any)=>fn(),backend:{
    readEvents:async()=>({events:[{seq:1,type:'step.completed',data:{taskId:'turn-1',stepId:'c1',toolName:'browser',detailRef:{seq:1}}}],nextSeq:1,hasMore:false}),
    readEventDetail:async()=>({text:raw})}};
  const result=await conversationResources(context,{commands:{}},'session-one','owner-one',-1);
  const item=result.sources.find((s:any)=>s.kind==='webpage');
  assert.equal(item.url,source.url);assert.equal(item.name,source.title);assert.match(item.uses[0].summary,/原文片段/);
  assert.ok(!JSON.stringify(result).includes(original));
  const env:any={URL,WeftUiCore:{factories:{}}};
  runInNewContext(readFileSync(new URL('../src/ui-core/resources.js',import.meta.url),'utf8'),env);
  const core:any={loadConversationResources:async()=>({sources:[item]})};
  const api=env.WeftUiCore.factories.resources(core,{},{});
  assert.ok(api.capturedSourceText(raw).includes(original));assert.match(api.capturedSourceText(raw),/2026-10-10/);
  assert.equal((await api.capturedSourceForUrl(source.url+'#section')).name,source.title);
  assert.equal(await api.capturedSourceForUrl('https://other.example/release'),null);
  assert.ok(!api.capturedSourceText(raw).includes('toolCallId'));
  const fetched=JSON.stringify({output:[{type:'text',text:'Fetched https://example.org (HTTP 200)\n\nTitle: Official\nURL: https://example.org\nAccessed: 2026-10-10T00:00:00Z\nExact original paragraph.\n\nCaptured source: C:/synthetic/cache.txt. Use grep/read.'}]});
  assert.match(api.capturedSourceText(fetched),/Exact original paragraph/);
  assert.doesNotMatch(api.capturedSourceText(fetched),/cache.txt|Use grep/);
});
