import { materializeLibraryExport, recoverNativeOutput } from './library-files.mjs';
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { digest, failure } from './common.mjs';
import { INTERNAL_ARTIFACT_KIND } from './constants.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';

export function libraryFileType(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg'].includes(ext)) return 'image';
  if (['.csv','.tsv','.xlsx','.xls','.ods'].includes(ext)) return 'spreadsheet';
  if (['.js','.ts','.tsx','.jsx','.py','.swift','.kt','.java','.c','.cpp','.h','.html','.css','.json','.yaml','.yml','.sh','.ps1','.sql','.rs','.go'].includes(ext)) return 'code';
  if (['.md','.txt','.pdf','.doc','.docx','.rtf','.odt','.ppt','.pptx'].includes(ext)) return 'document';
  return 'other';
}
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp'};
const textExtensions = new Set(['.md','.txt','.csv','.tsv','.log','.js','.ts','.tsx','.jsx','.py','.swift','.kt','.java','.c','.cpp','.h','.html','.css','.json','.yaml','.yml','.sh','.ps1','.sql','.rs','.go','.xml','.svg']);

/** A rebuildable account index over the existing verified output receipts.
 * No directory discovery, tool execution, copied provenance, or user file deletion. */
export function createLibrary(context, nativeActions = null) {
  const secret=randomBytes(32);
  const erasedSource=(account,row)=>{const at=account.activity?.erasedBefore?.[row.sessionId];return at&&Date.parse(account.commands[row.toolSource?.sourceCommandId]?.createdAt??row.createdAt)<=Date.parse(at);};
  const eligible=(account,row)=>row.kind===INTERNAL_ARTIFACT_KIND && row.state==='observed' &&
    row.verification?.status==='observed' && account.sessions[row.sessionId] && !row.libraryErased && !erasedSource(account,row) &&
    !(row.libraryPrivate ?? hasPrivateContent(account.sessions[row.sessionId]));
  const rows=owner=>Object.values(context.accountState(owner).commands).filter(row=>eligible(context.accountState(owner),row));
  function requireRow(owner,id) {const row=rows(owner).find(row=>row.artifactId===id);if(!row)throw failure('NOT_FOUND',404);return row;}
  const fileFor=(owner,row)=>row.nativeFile?.path??row.libraryExport?.path??path.join(context.root,'artifacts',owner,row.taskId,`${row.artifactId}.artifact`);
  async function inspect(owner,row) {
    const file=fileFor(owner,row),metadata=row.nativeFile??row.libraryExport;
    try {
      const stat=await lstat(file),identity=await lstat(file,{bigint:true});
      if(!stat.isFile()||stat.isSymbolicLink()||await realpath(file)!==file || metadata &&
        (String(identity.dev)!==String(metadata.device)||String(identity.ino)!==String(metadata.inode)))return {exists:false};
      return {exists:true,stat,file,identity};
    }catch{return {exists:false};}
  }
  async function project(owner,row) {
    const account=context.accountState(owner),status=await inspect(owner,row),session=account.sessions[row.sessionId];
    const segment=account.chatIdentity?.segments[account.chatIdentity.sessionSegments[row.sessionId]];
    const projectId=row.libraryProjectId===undefined?session?.projectId??null:row.libraryProjectId;
    return {id:row.artifactId,fileName:row.fileName,type:libraryFileType(row.fileName),
      size:status.stat?.size??row.size,location:fileFor(owner,row),exists:status.exists,
      createdAt:row.nativeFile?.createdAt??row.libraryExport?.createdAt??row.createdAt,modifiedAt:status.stat?.mtime.toISOString()??row.nativeFile?.modifiedAt??row.createdAt,
      projectId,projectName:account.projects?.[projectId]?.name??null,
      source:{sessionId:row.sessionId,chatId:segment?.chatId,taskId:row.taskId,messageId:row.toolSource?.sourceCommandId,turn:row.toolSource?.turn,callId:row.toolSource?.callId},
      previewPath:`/library/${row.artifactId}/preview`,
      actions:{open:status.exists&&!!nativeActions,show:status.exists&&!!nativeActions}};
  }
  function revision(owner) {return digest(JSON.stringify(rows(owner).map(r=>[r.artifactId,r.createdAt,r.sha256,r.libraryProjectId])));}
  function sign(value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;}
  function decode(value){try{const [body,hash,extra]=value.split('.');if(extra||hash!==createHmac('sha256',secret).update(body).digest('base64url'))throw 0;return JSON.parse(Buffer.from(body,'base64url'));}catch{throw failure('CURSOR_RESET_REQUIRED',409);}}
  async function list(owner,params) {
    const keys=['cursor','limit','projectId','type','after','before','search'];
    if([...params.keys()].some(k=>!keys.includes(k)||params.getAll(k).length!==1))throw failure('INVALID_REQUEST');
    const limit=Number(params.get('limit')??50),type=params.get('type'),projectId=params.get('projectId'),search=params.get('search')??'';
    const after=params.get('after'),before=params.get('before');
    if(!Number.isInteger(limit)||limit<1||limit>200||type&&!['document','spreadsheet','image','code','other'].includes(type)||search.length>200||
      [after,before].some(v=>v&&!Number.isFinite(Date.parse(v)))||after&&before&&Date.parse(after)>Date.parse(before))throw failure('INVALID_REQUEST');
    const filter=JSON.stringify([type,projectId,search,after,before]),rev=revision(owner);
    let offset=0;
    if(params.has('cursor')){const [user,version,query,position]=decode(params.get('cursor'));if(user!==owner||version!==rev||query!==filter||!Number.isSafeInteger(position)||position<0)throw failure('CURSOR_RESET_REQUIRED',409);offset=position;}
    for(const row of rows(owner)){await recoverNativeOutput(context,owner,row);await materializeLibraryExport(context,owner,row);}
    const all=rows(owner).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.artifactId.localeCompare(a.artifactId));
    // The same path is one file, with its latest native receipt as provenance.
    const latest=new Map();for(const row of all){const location=fileFor(owner,row),key=process.platform==='win32'?location.toLowerCase():location;if(!latest.has(key))latest.set(key,row);}
    const filtered=[...latest.values()].filter(r=>(!type||libraryFileType(r.fileName)===type)&&(!projectId||(r.libraryProjectId??context.accountState(owner).sessions[r.sessionId]?.projectId)===projectId)&&
      r.fileName.toLocaleLowerCase().includes(search.toLocaleLowerCase())&&(!after||Date.parse(r.createdAt)>=Date.parse(after))&&(!before||Date.parse(r.createdAt)<=Date.parse(before)));
    const items=await Promise.all(filtered.slice(offset,offset+limit).map(r=>project(owner,r)));
    if(revision(owner)!==rev)throw failure('CURSOR_RESET_REQUIRED',409);
    const projects=Object.values(context.accountState(owner).projects??{}).filter(p=>!p.revoked).map(p=>({id:p.projectId,name:p.name}));
    return {items,total:filtered.length,projects,hasMore:offset+limit<filtered.length,nextCursor:offset+limit<filtered.length?sign([owner,rev,filter,offset+limit]):null,revision:rev};
  }
  async function detail(owner,id) {
    let row=requireRow(owner,id);await recoverNativeOutput(context,owner,row);await materializeLibraryExport(context,owner,row);row=requireRow(owner,id);const item=await project(owner,row);let afterSeq=-1,more=true,fallback;
    while(more){const page=await context.callBackend(()=>context.backend.readEvents({ownerId:owner,sessionId:row.sessionId,afterSeq,limit:200}));
      const event=page.events.find(e=>e.type==='artifact.created'&&(e.data?.artifactId===id||e.data?.artifacts?.some(a=>a.artifactId===id)));
      const step=page.events.find(e=>e.data?.callId===row.toolSource?.callId||e.data?.stepId===row.toolSource?.callId);if(step)fallback=step;
      if(event){item.source.seq=event.seq;item.source.eventId=`event-${digest(`${context.accountState(owner).hostId}/${row.sessionId}/${event.seq}`)}`;break;}
      more=page.hasMore&&page.nextSeq>afterSeq;afterSeq=page.nextSeq;
    }
    if(item.source.seq===undefined&&fallback){item.source.seq=fallback.seq;item.source.eventId=`event-${digest(`${context.accountState(owner).hostId}/${row.sessionId}/${fallback.seq}`)}`;}
    requireRow(owner,id);return {item};
  }
  async function preview(owner,id) {
    let row=requireRow(owner,id);await recoverNativeOutput(context,owner,row);await materializeLibraryExport(context,owner,row);row=requireRow(owner,id);const item=await project(owner,row);if(!item.exists)return {item,kind:'missing'};
    const status=await inspect(owner,row);if(!status.exists)return {item:{...item,exists:false},kind:'missing'};
    const extension=path.extname(row.fileName).toLowerCase(),image=imageTypes[extension],pdf=extension==='.pdf';
    if(!image&&!pdf&&!textExtensions.has(extension))return {item,kind:'unsupported'};
    const limit=image?5*1024*1024:pdf?20*1024*1024:128*1024;
    if(status.stat.size>limit)return {item,kind:'unsupported',reason:'too_large'};
    const handle=await open(status.file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.dev!==status.identity.dev||stat.ino!==status.identity.ino||stat.size>BigInt(limit))throw failure('ARTIFACT_UNVERIFIED',409);
      // Bounded read even if another program grows the file after the stat.
      const bytes=Buffer.alloc(limit+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);requireRow(owner,id);
      if(bytesRead>limit)return {item,kind:'unsupported',reason:'too_large'};
      const content=bytes.subarray(0,bytesRead);
      if(image||pdf)return {item,kind:image?'image':'pdf',contentType:image??'application/pdf',data:content.toString('base64')};
      const text=content.toString('utf8');if(text.includes('\0')||!Buffer.from(text).equals(content))return {item,kind:'unsupported'};
      return {item,kind:extension==='.md'?'markdown':item.type==='code'?'code':'text',text};
    }finally{await handle.close();}
  }
  async function action(owner,id,action,authorize=()=>{}) {
    if(!nativeActions)throw failure('CAPABILITY_UNAVAILABLE',409);
    if(!['open','show'].includes(action))throw failure('INVALID_REQUEST');
    let row=requireRow(owner,id);await recoverNativeOutput(context,owner,row);await materializeLibraryExport(context,owner,row);row=requireRow(owner,id);const status=await inspect(owner,row);if(!status.exists)throw failure('NOT_FOUND',404);
    authorize();requireRow(owner,id);await nativeActions(action,status.file);return {opened:true};
  }
  return {list,detail,preview,action,desktopAvailable:!!nativeActions};
}
