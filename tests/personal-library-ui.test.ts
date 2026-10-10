import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function model(accessApi:any){
  const container:any={WeftUiCore:{factories:{}},URLSearchParams,Date};
  runInNewContext(await readFile(new URL('../src/ui-core/library.js',import.meta.url),'utf8'),container);
  const core:any={state:{ownerId:'alice',identityGeneration:1,personalCapabilities:{library:1}},accessApi,failureMessage:()=> '读取失败'};
  const effects:any={renderLibrary(){},clearLibraryPreview(){}};Object.assign(core,container.WeftUiCore.factories.library(core,effects));return core;
}
const page=(id:string,cursor:string|null=null)=>({items:[{id}],projects:[],total:1,nextCursor:cursor});

test('library discards late account reads and late preview bodies after switching identity',async()=>{
  let resolveList:any,resolvePreview:any;
  const core=await model((path:string)=>path.includes('/preview')?new Promise(resolve=>resolvePreview=resolve):core.state.ownerId==='alice'?new Promise(resolve=>resolveList=resolve):Promise.resolve(page('bob-file')));
  const old=core.readLibrary();core.state.ownerId='bob';core.state.identityGeneration++;await core.readLibrary();resolveList(page('alice-private'));await old;
  assert.equal(core.library.items[0].id,'bob-file');
  const preview=core.libraryPreview({id:'bob-file'});core.state.ownerId='carol';core.state.identityGeneration++;resolvePreview({kind:'text',text:'bob private'});await assert.rejects(preview,(error:any)=>error.code==='STALE_CONTEXT');
});

test('recent-file pagination reuses the exact time snapshot and changes invalidate pending previews',async()=>{
  const requests:string[]=[];let resolvePreview:any;
  const core=await model((path:string)=>{requests.push(path);return path.includes('/preview')?new Promise(resolve=>resolvePreview=resolve):Promise.resolve(page('file','signed-next'));});
  await core.readLibrary();await core.setLibraryFilter('time','7');await core.readLibrary(true);
  const first=new URL(requests.at(-2)!,'http://test'),second=new URL(requests.at(-1)!,'http://test');assert.equal(first.searchParams.get('after'),second.searchParams.get('after'));assert.equal(second.searchParams.get('cursor'),'signed-next');
  const preview=core.libraryPreview({id:'file'});await core.setLibraryFilter('search','another');resolvePreview({kind:'text',text:'old'});await assert.rejects(preview,(error:any)=>error.code==='STALE_CONTEXT');
});
