import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BL29_BASELINE_SHA, createBl29Baseline } from './integration/bl29-rework/baseline.mjs';

type Plan = { changed?: string[]; existing?: string[]; sources?: Record<string,string>; failure?: { command: string; error: Error } };
function gitFixture({changed=[],existing=[],sources={},failure}:Plan={}) {
  const calls:string[][]=[];
  function git(binary:string,args:string[],options:{cwd:string;encoding:string;windowsHide:boolean}) {
    assert.equal(binary,'git'); assert.equal(options.encoding,'utf8'); assert.equal(options.windowsHide,true);
    calls.push([...args]);
    if (args[0]===failure?.command) throw failure.error;
    if (args[0]==='diff') return changed.join('\0')+(changed.length?'\0':'');
    if (args[0]==='ls-tree') {
      const paths=args.slice(args.indexOf('--')+1);
      const files=existing.filter(file=>paths.some(path=>file===path||file.startsWith(path+'/')));
      return files.join('\0')+(files.length?'\0':'');
    }
    if (args[0]==='show') {
      const file=args[1].slice(BL29_BASELINE_SHA.length+1);
      assert.ok(Object.hasOwn(sources,file),`unexpected blob ${file}`);
      return sources[file];
    }
    throw new Error('unexpected git operation');
  }
  return {git,calls};
}

test('BL-29 before sources use the pre-208 commit for both selection and content, skipping additions and preserving empty files',()=>{
  assert.equal(BL29_BASELINE_SHA,'8f1b5de54e15720271e49e9b0653cd06ece3b096');
  const sources={
    'src/personal-access/index.mjs':'synthetic before host\n',
    'apps/mobile-ui/www/ui-core/presence.js':'synthetic old polling\n',
    'apps/mobile-ui/www/ui-core/empty.js':'',
  };
  const added='src/personal-desktop-request.mjs';
  const fixture=gitFixture({changed:[...Object.keys(sources),added],existing:Object.keys(sources),sources});
  const baseline=createBl29Baseline({git:fixture.git,cwd:'synthetic-worktree'});
  assert.deepEqual(baseline.changedSources(['src','apps/mobile-ui/www']),sources);
  assert.equal(baseline.read(added),undefined);
  assert.equal(baseline.read('apps/mobile-ui/www/ui-core/empty.js'),'');
  assert.deepEqual(fixture.calls.find(args=>args[0]==='diff'),
    ['diff','--name-only','-z',BL29_BASELINE_SHA,'HEAD','--','src','apps/mobile-ui/www']);
  assert.ok(!fixture.calls.some(args=>args.includes('--merge-base')||args.some(value=>value.includes('...'))));
  assert.ok(fixture.calls.filter(args=>args[0]==='ls-tree').every(args=>args.includes(BL29_BASELINE_SHA)));
  assert.ok(fixture.calls.filter(args=>args[0]==='show').every(args=>args[1].startsWith(BL29_BASELINE_SHA+':')));
  assert.ok(!fixture.calls.some(args=>args.some(value=>value.includes('origin/main'))));
  assert.ok(!fixture.calls.some(args=>args[0]==='show'&&args[1].endsWith(':'+added)));
});

test('BL-29 direct baseline reads skip only absent tree entries and keep existing blob errors visible',()=>{
  const file='src/personal-access/http.mjs';
  const fixture=gitFixture({existing:[file],sources:{[file]:'synthetic old routes'}});
  const baseline=createBl29Baseline({git:fixture.git,cwd:'synthetic-worktree'});
  assert.equal(baseline.read(file),'synthetic old routes');
  assert.equal(baseline.read('src/synthetic-added.mjs'),undefined);
  assert.equal(fixture.calls.filter(args=>args[0]==='show').length,1);
});

test('BL-29 missing revisions, repository failures and unreadable baseline blobs propagate without becoming optional additions',()=>{
  for (const command of ['diff','ls-tree','show']) {
    const error=Object.assign(new Error(`synthetic ${command} failure`),{status:128});
    const file='src/personal-access/index.mjs';
    const fixture=gitFixture({changed:[file],existing:[file],sources:{[file]:'old'},failure:{command,error}});
    const baseline=createBl29Baseline({git:fixture.git,cwd:'synthetic-worktree'});
    assert.throws(()=>baseline.changedSources(['src']),caught=>caught===error);
  }
});

test('all four BL-29 comparison probes share the pinned reader and contain no moving origin/main baseline',()=>{
  for (const file of ['probe-exit','probe-browser','zero-browser','old-host']) {
    const source=readFileSync(new URL(`./integration/bl29-rework/${file}.mjs`,import.meta.url),'utf8');
    assert.match(source,/import\s*\{createBl29Baseline\}\s*from '\.\/baseline\.mjs'/);
    assert.doesNotMatch(source,/origin\/main/);
  }
});
