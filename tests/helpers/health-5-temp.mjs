import {lstat,readdir,unlink,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {disposeManagedTemp} from './managed-temp.mjs';
/** Unlink junctions themselves before the repository's owned-temp disposal. */
export async function disposeHealthFixture(directory){
  const boundary=resolve(directory);if(resolve(await realpath(boundary))!==boundary)throw Error('Synthetic fixture root changed');
  async function walk(target){
    const rel=relative(boundary,target);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Synthetic fixture boundary changed');
    const stat=await lstat(target);if(stat.isSymbolicLink()){await unlink(target);return;}
    if(stat.isDirectory())for(const name of await readdir(target))await walk(join(target,name));
  }
  await walk(boundary);disposeManagedTemp(boundary);
}
