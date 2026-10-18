const {readdir,lstat,writeFile} = require('node:fs/promises');
const {join} = require('node:path');

// Count UTF-16 code units, as Win32 and std::wstring do. Include the separator
// after $INSTDIR and the legacy CreateDirectory reserve (MAX_PATH - 12).
async function installerPayloadPaths(root) {
  let maxSuffix=0,files=0,directories=0,longest='';
  async function visit(parts=[]) {
    for(const name of await readdir(join(root,...parts))) {
      const child=[...parts,name],entry=child.join('\\');
      const stat=await lstat(join(root,...child));
      if(stat.isSymbolicLink())throw Error('Installer payload must contain physical files and directories');
      const suffix=1+entry.length+(stat.isDirectory()?12:0);
      if(suffix>maxSuffix){maxSuffix=suffix;longest=entry;}
      if(stat.isDirectory()){directories++;await visit(child);}
      else if(stat.isFile())files++;
      else throw Error('Unsupported installer payload entry');
    }
  }
  await visit();
  if(!files)throw Error('Installer payload is empty');
  // These are added by NSIS after the archive is extracted.
  for(const entry of ['Uninstall WeftMate.exe','resources\\weftmate-install.json'])maxSuffix=Math.max(maxSuffix,1+entry.length);
  return {maxSuffix,files,directories,longest};
}
async function writeInstallerPayloadHeader(root,out) {
  const audit=await installerPayloadPaths(root);
  await writeFile(join(out,'installer-payload.h'),`// Generated from the complete win-unpacked tree.\n#define WEFT_INSTALL_MAX_SUFFIX ${audit.maxSuffix}\n`);
  await writeFile(join(out,'payload-paths.json'),JSON.stringify(audit,null,2)+'\n');
  return audit;
}
module.exports={installerPayloadPaths,writeInstallerPayloadHeader};
