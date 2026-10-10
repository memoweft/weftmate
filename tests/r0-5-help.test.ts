import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validateRelease} from '../scripts/build-release-notes.mjs';
function fixture(){const context:any={WeftUiCore:{factories:{}}};for(const file of ['help','shortcuts','release-notes'])runInNewContext(readFileSync(`src/ui-core/${file}.js`,'utf8'),context);
  const values=new Map(),storage={getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)};
  const core:any={state:{ownerId:'synthetic-a',identityGeneration:0},readUpdateState:async()=>({layers:[{layer:'ui',currentVersion:'1.2.0'},{layer:'app',currentVersion:'1.0.0'},{layer:'mobile-ui',currentVersion:'9.0.0',scope:'host-published'}]})};
  Object.assign(core,context.WeftUiCore.factories.help(core,{}, {storage,desktop:true}));return {context,core,values,storage};}
test('release records have valid dates, semantic versions and user-facing categories; generated records match source',()=>{
  const f=fixture(),expected=[];for(const file of readdirSync('docs/changelog').filter(file=>file.endsWith('.json'))){const record=validateRelease(JSON.parse(readFileSync(`docs/changelog/${file}`,'utf8')));for(const [audience,version]of Object.entries(record.versions)){const {versions,...body}=record;expected.push({...body,audience,version});}}
  const rows=JSON.parse(JSON.stringify(f.context.WeftUiCore.releaseNotes));assert.deepEqual(rows.sort((a:any,b:any)=>a.audience.localeCompare(b.audience)),expected.sort((a:any,b:any)=>a.audience.localeCompare(b.audience)));
  const source=JSON.parse(readFileSync('docs/changelog/2026-10-10.json','utf8'));for(const mutation of [{date:'2026-02-30'},{versions:{desktop:'v1',mobile:'0.8.24'}},{added:['UX-6 improved search']},{added:['R0-5 completed']},{unknown:[]},{fixed:['DSH updated']}])assert.throws(()=>validateRelease({...source,...mutation}));
});
test('update notice establishes a baseline, shows once per account/version and survives reload; rollback never repeats',()=>{
  const f=fixture();assert.equal(f.core.observeRelease('1.0.0'),false);assert.equal(f.core.observeRelease('1.1.0'),true);assert.equal(f.core.observeRelease('1.1.0'),false);
  const reloaded=f.context.WeftUiCore.factories.help(f.core,{}, {storage:f.storage});assert.equal(reloaded.observeRelease('1.1.0'),false);
  f.core.state.ownerId='synthetic-b';assert.equal(reloaded.observeRelease('1.1.0'),false);assert.equal(reloaded.observeRelease('1.2.0'),true);
  f.core.state.ownerId='synthetic-a';assert.equal(reloaded.observeRelease('1.2.0'),true);assert.equal(reloaded.observeRelease('1.0.0'),false);assert.equal(reloaded.observeRelease('1.2.0'),false);
  f.core.state.ownerId=null;assert.equal(reloaded.observeRelease('1.3.0'),false);assert.equal(reloaded.observeRelease('invalid'),false);
});
test('update notice ignores host-published phone bundle and obtains installed desktop version',async()=>{
  const f=fixture(),release=await f.core.currentRelease();assert.equal(release.version,'1.2.0');assert.deepEqual(JSON.parse(JSON.stringify(release.versions)),[{version:'1.2.0',layer:'ui'},{version:'1.0.0',layer:'app'}]);
});
test('help search filters all words locally across title, group and body; blank restores all topics',()=>{
  const f=fixture();assert.equal(f.core.filterHelp('').length,9);assert.equal(f.core.filterHelp('  ').length,9);assert.deepEqual(Array.from(f.core.filterHelp('记忆 纠正'),(row:any)=>row.id),['correct']);assert.equal(f.core.filterHelp('zz-no-result').length,0);assert.ok(f.core.filterHelp('离线').some((row:any)=>row.id==='offline'));
});
test('every shortcut in the panel registry dispatches its own action with identical modifier matching; composition is ignored',()=>{
  const {context}=fixture(),registry=context.WeftShortcuts;assert.equal(new Set(registry.rows.map((row:any)=>row.id)).size,registry.rows.length);
  for(const row of registry.rows){let called=0,prevented=0;const event={key:row.key,ctrlKey:row.mod,shiftKey:row.shift,altKey:row.alt,preventDefault:()=>prevented++};const actions={[row.id]:()=>called++};assert.equal(registry.dispatch(event,actions),true,row.id);assert.equal(called,1);assert.equal(prevented,1);
    assert.equal(registry.dispatch({...event,isComposing:true},actions),false);assert.equal(registry.dispatch({...event,shiftKey:!row.shift},actions),false);
    if(row.mod)assert.equal(registry.dispatch({...event,ctrlKey:false,metaKey:true},actions),true);}
  const source=readFileSync('src/personal-access-ui/components/help-view.js','utf8');assert.match(source,/for\(const row of WeftShortcuts.rows\)/);assert.match(source,/line.dataset.shortcutId=row.id/);
});
