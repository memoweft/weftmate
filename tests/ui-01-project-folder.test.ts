import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';

test('changing project folder requires native selection, preserves identity and files, and rejects stale/running changes', { skip:process.platform !== 'win32', timeout:30000 }, async t => {
  const f = await startTimelineCandidate({ historyCount:0 }); t.after(()=>f.close());
  const old = join(f.root,'old-project'), next = join(f.root,'new-project'); await mkdir(old); await mkdir(next);
  await writeFile(join(old,'kept.txt'),'original'); await writeFile(join(next,'kept.txt'),'destination');
  let project = (await f.request('/projects',{requestId:'ui01-project',name:'合成项目',rootPath:old,permission:'write'})).project;
  const patch = async (body:any, native=false) => {
    const response = await fetch(f.origin+'/personal/v1/projects/'+project.projectId,{method:'PATCH',headers:{origin:f.origin,cookie:f.debug.cookie,
      'content-type':'application/json','x-weftmate-csrf':f.debug.auth.csrfToken,...(native?{'x-weftmate-desktop':f.libraryDesktopToken}:{})},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await patch({rootPath:next,expectedRevision:project.revision})).status,403);
  const moved = await patch({rootPath:next,expectedRevision:project.revision},true); assert.equal(moved.status,200,JSON.stringify(moved.body));
  assert.equal(moved.body.project.projectId,project.projectId); assert.equal(moved.body.project.revision,2);
  assert.equal((await patch({rootPath:old,expectedRevision:1},true)).status,409);
  project=moved.body.project;
  const context=f.debug.service.__reviewContext, owner=f.debug.auth.account.ownerId;
  await context.serial(()=>context.mutate(owner,(state:any)=>{state.sessions[f.sessionId].projectId=project.projectId;state.sessions[f.sessionId].projectRevision=project.revision;}));
  assert.equal((await patch({rootPath:old,expectedRevision:2},true)).status,409);
  const actual=context.accountState(owner).projects[project.projectId]; assert.equal(actual.rootPath,next);
  assert.equal(await readFile(join(old,'kept.txt'),'utf8'),'original'); assert.equal(await readFile(join(next,'kept.txt'),'utf8'),'destination');
});
