import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {scan,check} from '../apps/apple/Scripts/check_callback_isolation.mjs';
test('callback review hashes are independent of Git checkout line endings',()=>{
 const source='view.visualEffect { @Sendable value in\n Task { @MainActor in model.accept(value) }\n}';
 assert.deepEqual(scan(source),scan(source.replaceAll('\n','\r\n')));
 assert.notDeepEqual(scan(source),scan(source.replace('@MainActor','')));
});
test('Apple reviewed callbacks retain their exact isolation boundary',()=>{
 assert.match(execFileSync(process.execPath,['apps/apple/Scripts/check_callback_isolation.mjs'],{encoding:'utf8'}),/0 failures/);
});
test('new and changed background callback actor access fails review',()=>{
 for(const api of ['visualEffect','alignmentGuide','onGeometryChange','onPreferenceChange','anchorPreference','Canvas']) {
  const safe=scan(`view.${api} { @Sendable value in value }`);
  const allowed=safe.map(r=>({...r,reason:'Pure Sendable transform; no main actor state is read.'}));
  assert.equal(check(safe,allowed).length,0);
  const bad=scan(`view.${api} { value in self.model.selection = value }`);
  assert.equal(check(bad,allowed).length,1,api);
  assert.equal(check(bad,[]).length,1,api);
 }
});
test('comments and string braces cannot hide a callback boundary',()=>{
 assert.equal(scan('// visualEffect { model.value }\nText("Canvas { x }")').length,0);
 assert.equal(scan('view.visualEffect { value in Text("}"); model.update(value) }').length,1);
});
test('labelled actions and completions remain inside the reviewed boundary',()=>{
 for(const source of [
  'view.onScrollGeometryChange(for: Double.self) { @Sendable g in g.height } action: { @Sendable _, value in Task { @MainActor in model.value = value } }',
  'view.fileExporter(item: file.map { Export($0) }, onCompletion: { @Sendable result in Task { @MainActor in model.accept(result) } }, onCancellation: {})'
 ]) {
  const rows=scan(source), allowed=rows.map(r=>({...r,reason:'Reviewed callback explicitly hops to the UI actor.'}));
  assert.equal(rows.length,1);
  assert.equal(check(scan(source.replace('Task { @MainActor in model.', 'Task { model.')),allowed).length,1);
 }
});
