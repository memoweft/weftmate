// Read-only official release payload, with the existing installed-smoke test
// identity metadata. Runtime resources remain read-only directory links.
import asar from '@electron/asar';
import { cp, mkdir, readFile, writeFile, symlink, readdir, rm, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export async function prepareConsoleRelease(source,destination,{updatedSource,updatedRuntime,identity='ux2console'}={}){
  source=resolve(source);destination=resolve(destination);await mkdir(destination,{recursive:true});
  for(const entry of await readdir(source,{withFileTypes:true})){
    if(entry.name==='resources')continue;
    await cp(join(source,entry.name),join(destination,entry.name),{recursive:entry.isDirectory()});
  }
  const resources=join(destination,'resources'),unpacked=join(destination,'app-source');await mkdir(resources);
  asar.extractAll(join(source,'resources/app.asar'),unpacked);
  const packageFile=join(unpacked,'package.json'),pkg=JSON.parse(await readFile(packageFile,'utf8'));
  if(!/^ux2console[a-z0-9]*$/.test(identity))throw Error('Console release requires a synthetic test identity.');
  pkg.name=`weftmate-${identity}`;pkg.desktopAppId=`com.memoweft.weftmate.${identity}`;pkg.desktopIdentity=`WeftMate ${identity}`;
  await writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');
  if(updatedSource)await cp(join(updatedSource,'src'),join(unpacked,'src'),{recursive:true});
  await asar.createPackageWithOptions(unpacked,join(resources,'app.asar'),{unpack:'**/*.node'});
  async function detach(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isSymbolicLink())await unlink(file);else if(entry.isDirectory())await detach(file);}}
  await detach(unpacked);await rm(unpacked,{recursive:true,force:true});
  for(const entry of await readdir(join(source,'resources'),{withFileTypes:true})){
    if(entry.name==='app.asar'||entry.name==='app.asar.unpacked')continue;
    if(entry.isDirectory())await symlink(entry.name==='dsh-runtime'&&updatedRuntime?resolve(updatedRuntime):join(source,'resources',entry.name),join(resources,entry.name),'junction');
    else await cp(join(source,'resources',entry.name),join(resources,entry.name));
  }
  const originalPackage=JSON.parse(asar.extractFile(join(source,'resources/app.asar'),'package.json').toString());
  const originalArchiveSha256=createHash('sha256').update(await readFile(join(source,'resources/app.asar'))).digest('hex');
  return{executable:join(destination,'WeftMate.exe'),sourceCode:updatedSource?'worktree':'official-preview3',version:originalPackage.version,originalArchiveSha256,syntheticDesktopIdentity:pkg.desktopIdentity,runtimeReadOnly:true};
}
