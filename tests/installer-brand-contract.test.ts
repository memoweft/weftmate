import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
test('branded installer retains the default NSIS build and current-user update contracts',()=>{
  assert.equal(pkg.build.nsis.script,undefined,'custom scripts bypass the builder uninstaller/size safeguards');
  assert.equal(pkg.build.nsis.differentialPackage,true);
  assert.equal(pkg.build.nsis.perMachine,false);
  assert.equal(pkg.build.nsis.allowElevation,false);
  assert.equal(pkg.build.nsis.packElevateHelper,false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
  assert.equal(pkg.build.nsis.license,undefined,'installation must not pause on a license page');
});
test('installer, app and uninstall icons share a sharp multi-size ICO',async()=>{
  const expected=pkg.build.win.icon;
  assert.equal(pkg.build.nsis.installerIcon,expected);
  assert.equal(pkg.build.nsis.uninstallerIcon,expected);
  const ico=await readFile(new URL('../'+expected,import.meta.url));
  assert.equal(ico.readUInt16LE(2),1);
  const sizes=[];
  for(let i=0;i<ico.readUInt16LE(4);i++){
    const offset=6+i*16;
    sizes.push(ico[offset]||256);
    const length=ico.readUInt32LE(offset+8),start=ico.readUInt32LE(offset+12);
    assert.ok(start+length<=ico.length,'every image payload must be complete');
    assert.equal(ico[offset+1]||256,ico[offset]||256);
  }
  for(const size of [16,20,24,32,40,48,64,128,256])assert.ok(sizes.includes(size),`missing ${size}px icon`);
});
