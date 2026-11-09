import path from 'node:path';
import {readdir,lstat} from 'node:fs/promises';
import {verify} from './archive.mjs';

const identity=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');

/** Read-only inventory. Restore/import/pruning keep their independent full-byte verification. */
export function createBackupCatalog({verifyFile=verify}={}) {
  const verified=new Map();
  async function row(file,id,info) {
    const signature=identity(info),previous=verified.get(file);
    if(previous?.signature===signature)return previous.result;
    const entry={signature,result:null};
    entry.result=Promise.resolve().then(async()=>{
      try{
        const manifest=await verifyFile(file),after=await lstat(file,{bigint:true});
        if(!after.isFile()||after.isSymbolicLink()||identity(after)!==signature)throw Error('BACKUP_CHANGED');
        return {id,createdAt:manifest.createdAt,reason:manifest.reason,size:Number(info.size),verification:'valid'};
      }catch{
        if(verified.get(file)===entry)verified.delete(file);
        return {id,createdAt:new Date(Number(info.mtimeMs)).toISOString(),size:Number(info.size),verification:'invalid'};
      }
    });
    verified.set(file,entry);
    return entry.result;
  }
  return {
    clear(){verified.clear();},
    async list(directory,{until}={}) {
      const root=path.resolve(directory),files=[];
      const names=await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      for(const id of names){
        if(!id.endsWith('.wmb'))continue;
        const file=path.join(root,id),info=await lstat(file,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(info?.isFile()&&!info.isSymbolicLink())files.push({file,id,info});
      }
      const present=new Set(files.map(row=>row.file));
      for(const file of verified.keys())if(path.dirname(file)===root&&!present.has(file))verified.delete(file);
      files.sort((a,b)=>a.info.mtimeNs===b.info.mtimeNs?b.id.localeCompare(a.id):a.info.mtimeNs>b.info.mtimeNs?-1:1);
      const rows=[];
      for(const file of files){const value={...await row(file.file,file.id,file.info)};rows.push(value);if(until?.(value))break;}
      return rows.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    },
  };
}
