/** Only this acceptance runner's marked synthetic fixture may be removed. */
import {readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,parse} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'');
assert.equal(parse(root).root,parse(process.env.SystemRoot).root);
assert.match(root,/^[A-Z]:\\(?:weftmate-inst1-qa-[a-f0-9]{32}|wi1-[a-f0-9]{16})$/i);
const profile=join(root,'synthetic-data');
assert.equal(JSON.parse(readFileSync(join(profile,'.weftmate-personal-host-profile.json'),'utf8')).purpose,'isolated-personal-host');
assert.equal(readFileSync(join(profile,'keep-me.txt'),'utf8'),'INST-1 synthetic data must survive upgrades and uninstall');
const uninstaller=join(root,'installed','Uninstall WeftMate-inst1qa.exe');
if(existsSync(uninstaller)){
  const result=spawnSync(uninstaller,['/S','/currentuser',`_?=${join(root,'installed')}`],{windowsHide:true});
  assert.equal(result.status,0,'uninstall the verified test identity before removing its fixture');
}
const control=join(process.env.APPDATA,'WeftMate inst1qa');
if(existsSync(control)){
  assert.equal(JSON.parse(readFileSync(join(control,'WeftMate/desktop-config.json'),'utf8')).dataDirectory,profile);
  rmSync(control,{recursive:true,force:true});
}
rmSync(root,{recursive:true,force:true});
// The NSIS cache uses the isolated package name, never the daily namespace.
rmSync(join(process.env.LOCALAPPDATA,'weftmate-inst1qa-updater'),{recursive:true,force:true});
console.log('Removed the verified INST-1 synthetic fixture and its isolated control namespace.');
