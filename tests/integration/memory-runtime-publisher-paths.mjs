/** Uses the actual hash-verified wheel assembled by the full Windows job. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {packagedBinaryViolation,packagedTextViolation} from '../../scripts/windows-package-policy.mjs';

test('fixed upstream wheel files permit only their documented publisher HOME/account collision',async()=>{
  assert.ok(process.env.WEFTMATE_MEMORY_RUNTIME_DIR,'requires the prepared full memory runtime');
  const files={
    'site-packages/tokenizers/tokenizers.pyd':'7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df',
    'site-packages/hf_xet/hf_xet.pyd':'246516c4a365fcd9befa6f901a82ec3478bcdf7952c04fba2d0926024711ccc2',
    'site-packages/numpy/__config__.py':'621939d2b6fcf0c162f654ea53a2deb8027a16ab2556c69ae4697679ae227df6',
    'site-packages/numpy-2.4.3.dist-info/DELVEWHEEL':'f0b8626921a4df68c3b04c5968d0a5611c67b9fd15b30fddf10c319fdec18971',
  };
  const identity={home:'C:/Users/runneradmin',username:'runneradmin',hostname:'SYNTHETIC-BUILDER-HOST',roots:['D:/a/weftmate/weftmate']};
  const inspect=(bytes,name,who)=>bytes.includes(0)?packagedBinaryViolation(bytes,name,who):packagedTextViolation(bytes.toString('utf8'),name,who);
  for(const [relative,sha256] of Object.entries(files)){
    const name='memory-runtime/'+relative,bytes=await readFile(join(process.env.WEFTMATE_MEMORY_RUNTIME_DIR,relative));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);
    assert.equal(inspect(bytes,name,identity),null,name);
    assert.equal(inspect(bytes,name.replaceAll('/','\\'),{...identity,home:'C:\\Users\\runneradmin'}),null,name);
    assert.equal(inspect(bytes,name,{...identity,home:'C:/Users'}),'build-machine-identity');
    assert.equal(inspect(bytes,name,{...identity,hostname:'runneradmin'}),'build-machine-identity');
    for(const file of ['copy/'+relative,'memory-runtime/other/'+relative])assert.equal(inspect(bytes,file,identity),'build-machine-identity');
    const altered=Buffer.from(bytes);altered[0]^=1;
    assert.equal(inspect(altered,name,identity),'build-machine-identity');
    for(const value of [identity.home+'/private-output',identity.roots[0]+'/source',identity.hostname]){
      for(const encoding of ['utf8','utf16le'])assert.equal(inspect(Buffer.concat([bytes,Buffer.from(value,encoding)]),name,identity),'build-machine-identity');
    }
    // A source root is never waived, even when it overlaps a publisher path.
    assert.equal(inspect(bytes,name,{...identity,roots:[identity.home]}),'build-machine-identity');
  }
});
