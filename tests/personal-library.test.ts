import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,lstat,rename,rm,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLibrary } from '../src/personal-access/library.mjs';
import { recoverNativeOutput } from '../src/personal-access/library-files.mjs';
import { eraseChatCopies } from '../src/personal-access/chat-erasure.mjs';

async function fixture(t:any){
  const root=await mkdtemp(join(tmpdir(),'weftmate-library-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const accounts:any={alice:{hostId:'host-a',sessions:{chat:{origin:'personal-remote'}},commands:{},projects:{project:{projectId:'project',name:'旅行'}}},bob:{hostId:'host-b',sessions:{chat:{origin:'personal-remote'}},commands:{}}};
  const actions:any[]=[];
  const context:any={root,accountState:(owner:string)=>accounts[owner],callBackend:(call:()=>any)=>call(),backend:{readEvents:async()=>({events:[{seq:7,type:'artifact.created',data:{artifactId:'one'}}],nextSeq:7,hasMore:false})}};
  const library=createLibrary(context,async(action:string,file:string)=>{actions.push({action,file});});
  async function output(owner:string,id:string,name:string,body:Buffer|string,extra:any={}){
    const file=join(root,`${owner}-${name}`);await writeFile(file,body);const stat=await lstat(file),identity=await lstat(file,{bigint:true});
    accounts[owner].commands[id]={kind:'artifact.create',state:'observed',verification:{status:'observed'},artifactId:id,fileName:name,size:stat.size,
      sessionId:'chat',taskId:'task',createdAt:'2026-10-10T00:00:00.000Z',libraryProjectId:owner==='alice'?'project':null,
      nativeFile:{path:file,device:String(identity.dev),inode:String(identity.ino),createdAt:stat.birthtime.toISOString(),modifiedAt:stat.mtime.toISOString()},toolSource:{sourceCommandId:'message',turn:1,callId:'write'},...extra};
    return file;
  }
  return {root,accounts,library,output,actions};
}

test('library uses account output receipts, signed filter-bound pages and native source location',async t=>{
  const {library,output,accounts}=await fixture(t);
  // Use the host's existing internal artifact kind.
  const {INTERNAL_ARTIFACT_KIND}=await import('../src/personal-access/constants.mjs');
  await output('alice','one','plan.md','# Plan');await output('alice','two','cost.csv','item,cost\npen,2');await output('bob','secret','secret.md','private');
  for(const account of Object.values(accounts) as any[])for(const row of Object.values(account.commands) as any[])row.kind=INTERNAL_ARTIFACT_KIND;
  const first=await library.list('alice',new URLSearchParams('limit=1'));assert.equal(first.total,2);assert.ok(first.nextCursor);
  const second=await library.list('alice',new URLSearchParams({limit:'1',cursor:first.nextCursor}));assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);
  await assert.rejects(library.list('bob',new URLSearchParams({cursor:first.nextCursor})),{code:'CURSOR_RESET_REQUIRED'});
  await assert.rejects(library.list('alice',new URLSearchParams({cursor:first.nextCursor,type:'document'})),{code:'CURSOR_RESET_REQUIRED'});
  await assert.rejects(library.detail('alice','secret'),{code:'NOT_FOUND'});
  assert.equal((await library.list('alice',new URLSearchParams('type=spreadsheet&projectId=project&search=cost&after=2026-10-09'))).total,1);
  const detail=await library.detail('alice','one');assert.equal(detail.item.source.seq,7);assert.equal(detail.item.source.messageId,'message');assert.ok(detail.item.source.eventId.startsWith('event-'));
  delete accounts.alice.commands.two;await assert.rejects(library.list('alice',new URLSearchParams({cursor:first.nextCursor})),{code:'CURSOR_RESET_REQUIRED'});
});

test('moved, replaced and symlink files cannot be read or launched; preview is bounded and typed',async t=>{
  const {library,output,accounts,actions,root}=await fixture(t);const {INTERNAL_ARTIFACT_KIND}=await import('../src/personal-access/constants.mjs');
  const file=await output('alice','one','plan.md','# Plan');accounts.alice.commands.one.kind=INTERNAL_ARTIFACT_KIND;
  assert.equal((await library.preview('alice','one')).kind,'markdown');await library.action('alice','one','show');assert.equal(actions[0].file,file);
  await rename(file,file+'.moved');assert.equal((await library.list('alice',new URLSearchParams())).items[0].exists,false);assert.equal((await library.preview('alice','one')).kind,'missing');await assert.rejects(library.action('alice','one','open'),{code:'NOT_FOUND'});
  await writeFile(file,'replacement');assert.equal((await library.preview('alice','one')).kind,'missing');await rm(file);
  try{await symlink(file+'.moved',file);assert.equal((await library.preview('alice','one')).kind,'missing');}catch(error:any){if(error.code!=='EPERM')throw error;}
  await output('alice','image','picture.png',Buffer.from([0,1,2,3]));accounts.alice.commands.image.kind=INTERNAL_ARTIFACT_KIND;const image=await library.preview('alice','image');assert.equal(image.kind,'image');assert.equal(image.contentType,'image/png');
  await output('alice','large','large.txt','x'.repeat(128*1024+1));accounts.alice.commands.large.kind=INTERNAL_ARTIFACT_KIND;assert.equal((await library.preview('alice','large')).reason,'too_large');
});

test('temporary turns never enter the global index; D33 clears derived receipts without deleting files',async t=>{
  const {library,output,accounts}=await fixture(t);const {INTERNAL_ARTIFACT_KIND}=await import('../src/personal-access/constants.mjs');
  const file=await output('alice','one','plan.md','# Plan',{libraryPrivate:false});await output('alice','temporary','private.txt','secret',{libraryPrivate:true});
  for(const row of Object.values(accounts.alice.commands) as any[])row.kind=INTERNAL_ARTIFACT_KIND;
  accounts.alice.sessions.chat.hasTemporaryContent=true;assert.deepEqual((await library.list('alice',new URLSearchParams())).items.map((i:any)=>i.id),['one']);
  eraseChatCopies(accounts.alice,{forgotten:true});assert.equal((await library.list('alice',new URLSearchParams())).total,0);assert.ok((await lstat(file)).isFile());assert.equal(accounts.alice.commands.one.nativeFile,undefined);
});

test('legacy native locations recover only from the original artifact and call, including missing originals',async t=>{
  const {output,accounts,root}=await fixture(t);const {INTERNAL_ARTIFACT_KIND}=await import('../src/personal-access/constants.mjs');
  const file=await output('alice','one','old.md','# old');const row=accounts.alice.commands.one;row.commandId='one';row.kind=INTERNAL_ARTIFACT_KIND;row.nativeFileObserved=true;delete row.nativeFile;
  const event:any={seq:7,type:'artifact.created',data:{artifactId:'one',completedStep:{callId:'write'}}};
  const context:any={root,accountState:(owner:string)=>accounts[owner],callBackend:(fn:()=>any)=>fn(),serial:(fn:()=>any)=>fn(),mutate:(owner:string,fn:any)=>fn(accounts[owner]),
    backend:{readEvents:async()=>({events:[event],nextSeq:7,hasMore:false}),readEventDetail:async()=>({text:JSON.stringify({arguments:JSON.stringify({file_path:file}),output:[{text:JSON.stringify({artifact:{artifactId:'one'},createdFilePath:file})}]})})}};
  event.data.completedStep.callId='another-call';await recoverNativeOutput(context,'alice',row);assert.equal(row.nativeFile,undefined);
  event.data.completedStep.callId='write';await rename(file,file+'.moved');await recoverNativeOutput(context,'alice',row);assert.equal(row.nativeFile.path,file);assert.equal(row.nativeFile.inode,'0');
});
