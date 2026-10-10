import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPersonalAccessService} from '../src/personal-access/index.mjs';
import {runInNewContext} from 'node:vm';
import {folderWarning,folderPathHint} from '../src/personal-projects/folder-choice.mjs';
function fixture() {
 const context:any={};runInNewContext(readFileSync(new URL('../src/ui-core/sessions.js',import.meta.url),'utf8'),Object.assign(context,{globalThis:{WeftUiCore:{factories:{}}}}));
 const values=new Map(),calls:any[]=[];
 const state:any={ownerId:'a',hostId:'h',identityGeneration:1,selectedSessionId:'s',projects:[{projectId:'p',name:'合成项目',permission:'write'}],sessions:[{sessionId:'s'}],attachmentDrafts:new Map([['a|s',[{file:{name:'notes.txt'}}]]])};
 const core:any={state,updateSession:async(id:any,patch:any)=>{calls.push({id,patch});Object.assign(state.sessions[0],patch)},openSideChat:async(fields:any)=>calls.push(fields)};
 const effects={updateAvailability:()=>{}};
 const actions=context.globalThis.WeftUiCore.factories.sessions(core,effects,{storage:{getItem:(key:any)=>values.get(key),setItem:(key:any,value:any)=>values.set(key,value)}});Object.assign(core,actions);
 // Keep the real migration boundary independent of HTTP fixture setup.
 core.updateSession=async(id:any,patch:any)=>{calls.push({id,patch});Object.assign(state.sessions[0],patch)};
 return {core,state,calls,values};
}
test('UX-9 existing project moves the conversation and preserves attachment drafts',async()=>{const f=fixture(),files=f.state.attachmentDrafts.get('a|s');await f.core.chooseFolderProject(f.state.projects[0]);assert.equal(f.calls[0].patch.projectId,'p');assert.equal(f.state.attachmentDrafts.get('a|s'),files);assert.equal(f.core.defaultFolderProject().projectId,'p');});
test('UX-9 blank conversation keeps pending folder without creating a second conversation',async()=>{const f=fixture();f.state.newConversation=true;f.state.selectedSessionId=null;await f.core.chooseFolderProject(f.state.projects[0]);assert.equal(f.state.newConversationProjectId,'p');assert.equal(f.calls.length,0);});
test('UX-9 main conversation creates a project side chat through the existing draft-transfer action',async()=>{const f=fixture();f.core.inMainChat=()=>true;await f.core.chooseFolderProject(f.state.projects[0]);assert.equal(f.calls[0].parent.kind,'project');assert.equal(f.calls[0].parent.id,'p');assert.equal(f.calls[0].entry,'composer');});
test('UX-9 no folder choice is remembered and isolated by account',async()=>{const f=fixture();await f.core.chooseFolderProject(f.state.projects[0]);await f.core.chooseFolderProject(null);assert.equal(f.calls[1].patch.projectId,null);assert.equal(f.core.defaultFolderProject(),null);f.state.ownerId='b';assert.equal(f.core.folderPreference().selected,undefined);});
test('UX-9 selecting is locked during uncertain send and attachment upload',async()=>{for(const key of ['unresolvedSubmission','attachmentUpload','sessionSelecting']){const f=fixture();f.state[key]=true;await assert.rejects(f.core.chooseFolderProject(f.state.projects[0]),(error:any)=>error.code==='SESSION_BUSY');assert.equal(f.calls.length,0);}});
test('UX-9 high risk warnings cover disk, personal home and system locations',()=>{assert.ok(folderWarning('C:\\','C:\\Users\\Fixture'));assert.ok(folderWarning('C:\\Users\\Fixture','C:\\Users\\Fixture'));assert.ok(folderWarning('C:\\Windows\\System32','C:\\Users\\Fixture'));assert.equal(folderWarning('C:\\Projects\\Fixture','C:\\Users\\Fixture'),'');assert.equal(folderPathHint('C:\\Projects\\Fixture'),'Projects / Fixture');});

test('UX-9 dropped directory uses folder selection; ordinary and zero-byte files stay attachments',async()=>{const f=fixture(),folder={name:'workspace'},file={name:'notes.txt'},empty={name:'empty.txt',size:0};const result=await f.core.partitionFolderDrop([folder,file,empty],async(value:any)=>value===folder?'C:\\Synthetic\\workspace':null);assert.equal(result.folders[0].file,folder);assert.equal(result.folders[0].path,'C:\\Synthetic\\workspace');assert.equal(result.files.length,2);assert.equal(result.files[0],file);assert.equal(result.files[1],empty);});

test('UX-9 new-folder API uses existing permission revisions and never returns a full browser path', async t=>{
 const root=await mkdtemp(join(tmpdir(),'weftmate-ux9-contract-')),folder=join(root,'Synthetic');await mkdir(folder);
 const backend:any=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>name==='listModels'?[]:{}]));
 const service=await createPersonalAccessService({root:join(root,'host'),port:0,backend});const {origin}=await service.start();
 t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const grant=await service.issueSetupGrant(),response=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'FolderContract',password:'Synthetic-'+randomUUID(),deviceName:'合成电脑'})});assert.equal(response.status,201);
 const auth:any=await response.json(),cookie=response.headers.get('set-cookie')!.split(';')[0];
 const headers:any={cookie,origin,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken,'sec-fetch-site':'same-origin'};
 const body={requestId:randomUUID(),name:'Synthetic',rootPath:process.platform==='win32'?folder:'C:\\Synthetic\\NativeOnly'};
 const rejected=await fetch(origin+'/personal/v1/projects',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(rejected.status,403);assert.equal((await rejected.json()).error.code,'PROJECT_NATIVE_SELECTION_REQUIRED');
 const trusted={...headers,'x-weftmate-desktop':service.libraryDesktopToken};
 const created=await fetch(origin+'/personal/v1/projects',{method:'POST',headers:trusted,body:JSON.stringify(body)});if(process.platform!=='win32'){assert.equal(created.status,503);assert.equal((await created.json()).error.code,'PROJECT_WINDOWS_REQUIRED');return;}assert.equal(created.status,201);const project=(await created.json()).project;assert.equal(project.permission,'read-only');assert.equal(project.rootPath,undefined);assert.ok(project.pathHint.endsWith('Synthetic'));
 const patched=await fetch(origin+'/personal/v1/projects/'+project.projectId,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:project.revision,permission:'write'})});assert.equal(patched.status,200);const next=(await patched.json()).project;assert.equal(next.permission,'write');assert.equal(next.revision,project.revision+1);
 const list=await(await fetch(origin+'/personal/v1/projects',{headers})).json();assert.equal(list.projects[0].rootPath,undefined);
 const local=await(await fetch(origin+'/personal/v1/projects',{headers:trusted})).json();assert.equal(local.projects[0].rootPath.toLowerCase(),folder.toLowerCase());
});

test('UX-9 a late folder mutation cannot keep a different account busy or release its new mutation',async()=>{
 const f=fixture();let first:any,second:any;let count=0;f.core.updateSession=()=>new Promise(resolve=>{if(++count===1)first=resolve;else second=resolve;});
 const a=f.core.chooseFolderProject(f.state.projects[0]);assert.equal(f.core.folderMutationPending(),true);
 f.state.ownerId='b';f.state.identityGeneration++;assert.equal(f.core.folderMutationPending(),false);
 const b=f.core.chooseFolderProject(f.state.projects[0]);first({});await a;assert.equal(f.core.folderMutationPending(),true);second({});await b;assert.equal(f.core.folderMutationPending(),false);
});
test('UX-9 folder registration is scoped to the original draft and leaves attachment drafts intact',async()=>{
 const f=fixture();let finish:any;f.core.refreshSessionProjects=async()=>{};const files=f.state.attachmentDrafts.get('a|s');
 const pending=f.core.registerFolderChoice(()=>new Promise(resolve=>finish=resolve),{});assert.equal(f.core.folderMutationPending(),true);
 f.state.selectedSessionId='another';assert.equal(f.core.folderMutationPending(),false);finish({project:f.state.projects[0]});assert.equal(await pending,null);assert.equal(f.state.attachmentDrafts.get('a|s'),files);
});
