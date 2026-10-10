import { enterProfileWrite } from '../personal-backup/write-barrier.mjs';
import path from 'node:path';
import { lstat,writeFile,readFile } from 'node:fs/promises';
import { ensurePrivateDirectory,ensurePrivateFile } from '../private-host-storage.mjs';
import { digest,failure } from './common.mjs';
import { sessionWorkspace } from './session-workspace.mjs';
import { realpath } from 'node:fs/promises';

/** Recover old native locations from their existing tool result/call, never a directory scan. */
export async function recoverNativeOutput(context,ownerId,command) {
  if(!command.nativeFileObserved||command.nativeFile||command.libraryErased||typeof context.backend.readEventDetail!=='function')return;
  let afterSeq=-1,more=true,file;
  while(more&&!file){
    const page=await context.callBackend(()=>context.backend.readEvents({ownerId,sessionId:command.sessionId,afterSeq,limit:200}));
    for(const event of page.events){
      const step=event.data?.completedStep;
      if((step?.callId??step?.stepId)!==command.toolSource?.callId)continue;
      if(event.type!=='artifact.created'||!(event.data?.artifactId===command.artifactId||event.data?.artifacts?.some(row=>row.artifactId===command.artifactId)))continue;
      const detail=await context.callBackend(()=>context.backend.readEventDetail({ownerId,sessionId:command.sessionId,seq:event.seq}));
      let raw;try{raw=JSON.parse(detail.text);}catch{continue;}
      const visit=value=>{if(!value||typeof value!=='object')return;
        if(value.artifact?.artifactId===command.artifactId&&typeof value.createdFilePath==='string')file=value.createdFilePath;
        for(const child of Object.values(value)){if(typeof child==='string'){try{visit(JSON.parse(child));}catch{}}else if(child&&typeof child==='object')visit(child);}
      };visit(raw.output);
      if(!file){let args=raw.arguments;try{if(typeof args==='string')args=JSON.parse(args);}catch{args=null;}
        if(typeof args?.file_path==='string'&&path.basename(args.file_path).normalize('NFC')===command.fileName){
          const account=context.accountState(ownerId),source=account.commands[command.toolSource?.sourceCommandId];
          const cwd=account.projects?.[source?.payload?.projectId]?.rootPath??sessionWorkspace(path.join(path.dirname(context.root),'conversations'),ownerId,source?.payload?.chatId??command.sessionId);
          file=path.resolve(cwd,args.file_path);
        }
      }
    }
    more=page.hasMore&&page.nextSeq>afterSeq;afterSeq=page.nextSeq;
  }
  if(!file||!path.isAbsolute(file))return;
  file=path.resolve(file);let stat;
  try{const candidate=await lstat(file,{bigint:true}),canonical=await realpath(file);
    if(candidate.isFile()&&!candidate.isSymbolicLink()&&(process.platform==='win32'?canonical.toLowerCase()===file.toLowerCase():canonical===file)){stat=candidate;file=canonical;}
  }catch{/* Keep the old original location even when it has already gone. */}
  await context.serial(()=>context.mutate(ownerId,next=>{const row=next.commands[command.commandId];if(!row||row.libraryErased||row.nativeFile)return;
    row.nativeFile={path:file,size:row.size,sha256:row.sha256,device:String(stat?.dev??0),inode:String(stat?.ino??0),
      createdAt:stat?.birthtime.toISOString()??row.createdAt,modifiedAt:stat?.mtime.toISOString()??row.createdAt,snapshot:true};
    row.libraryProjectId??=next.commands[row.toolSource?.sourceCommandId]?.payload?.projectId??null;
  }));
}

/** Give existing verified text exports their real filename for the default app.
 * The output directory is separate from deletable conversation snapshots. */
export async function materializeLibraryExport(context,ownerId,command) {
  if(command.nativeFile||command.nativeFileObserved||command.libraryExport||command.libraryErased||command.libraryPrivate)return;
  const bytes=await context.artifactStore.inspect(ownerId,command.taskId,command.artifactId,command);
  const directory=path.join(context.root,'outputs',ownerId,command.artifactId),file=path.join(directory,command.fileName);
  const release=await enterProfileWrite(file);
  try {
  await ensurePrivateDirectory(directory);
  try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  await ensurePrivateFile(file);
  if(digest(await readFile(file))!==command.sha256)throw failure('ARTIFACT_UNVERIFIED',409);
  const stat=await lstat(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||Number(stat.size)!==command.size)throw failure('ARTIFACT_UNVERIFIED',409);
  await context.serial(()=>context.mutate(ownerId,next=>{const row=next.commands[command.commandId];
    if(!row||row.libraryErased||row.libraryExport)return;
    row.libraryExport={path:file,size:command.size,sha256:command.sha256,device:String(stat.dev),inode:String(stat.ino),
      createdAt:command.createdAt,modifiedAt:stat.mtime.toISOString(),snapshot:true};
  }));
  } finally { release(); }
}
