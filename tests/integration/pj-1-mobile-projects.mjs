import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join, extname, relative, isAbsolute } from 'node:path';
import { mobileBridge } from '../../scripts/review-gallery/mobile-bridge.mjs';

/** Run the Android interface bundle through its native transport, against the real isolated host. */
export async function verifyMobileProjects({ origin, credentials, evidence, api, project, sessionId }) {
  const repository = resolve(import.meta.dirname, '../..'), assets = join(repository, 'apps/mobile-ui/www');
  const ownerId = (await api('/auth/me')).body.account.ownerId, hostId = (await api('/status')).body.hostId;
  const native = mobileBridge({ origin, credentials, ownerId }, 'light');
  await native({ method: 'auth.login', params: { ...credentials, deviceName: 'Synthetic PJ-1 mobile bundle' } });
  const business = (path, method = 'GET', body) => native({ method: 'host.business', params: { path: '/personal/v1' + path, method, body } });
  const bridge = async input => {
    if (input.method === 'shared.projects.list') return { ...await business('/projects'), source: 'host', hostId };
    if (input.method === 'shared.projects.createSession') return { ...await business(`/projects/${input.params.projectId}/sessions`, 'POST', {requestId:input.params.requestId, modelProfileId:input.params.modelProfileId}), source:'host' };
    if (input.method === 'models.host') return { source:'host', models: (await business('/models')).models.map(model => ({...model, profileId:model.id,displayName:model.name,modelId:model.model})) };
    if (input.method === 'shared.send') {
      const result = await business('/commands','POST',{...input.params,kind:'session.message',targetDeviceId:hostId});
      return {source:'host',sessionId:input.params.sessionId,requestId:input.params.requestId,state:'accepted',command:result.command};
    }
    return native(input);
  };
  const server = createServer((req,res) => {
    try {
      const file=resolve(assets,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
      const rel=relative(assets,file); if(rel.startsWith('..')||isAbsolute(rel)) return res.writeHead(404).end();
      res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
    }catch{res.writeHead(404).end();}
  });
  let browser; const errors=[];
  try {
    await new Promise(done=>server.listen(0,'127.0.0.1',done)); browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('__pjNative',async payload=>{try{return{id:payload.id,ok:true,result:await bridge(payload)}}catch(error){return{id:payload.id,ok:false,error:{code:error.message,status:error.status}}}});
    await page.addInitScript(()=>window.weftNative={postMessage(value){window.__pjNative(JSON.parse(value)).then(result=>window.weftNative.onmessage({data:JSON.stringify(result)}));}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>state.booted&&state.loggedIn);
    await page.evaluate(()=>page('home'));
    await page.getByRole('main').getByRole('button',{name:project.name,exact:true}).waitFor();
    const projectIcon = await page.getByRole('main').getByRole('button',{name:`在项目 ${project.name} 新建对话`,exact:true}).locator('img').boundingBox(); assert.ok(projectIcon.width <= 24 && projectIcon.height <= 24, 'project add icon keeps a compact accessible button');
    for(const theme of ['light','dark']){await page.evaluate(theme=>applyTheme(theme),theme);await page.screenshot({path:join(evidence,`mobile-bundle-projects-${theme}.png`)});}
    await page.getByRole('main').getByRole('button',{name:`在项目 ${project.name} 新建对话`,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'新建项目对话',exact:true});await dialog.getByRole('button',{name:'新建对话',exact:true}).click();
    await page.waitForFunction(id=>state.page==='chat'&&state.sharedSessions.some(session=>session.sessionId===state.sharedSessionId&&session.projectId===id),project.projectId);
    await page.screenshot({path:join(evidence,'mobile-bundle-project-new-conversation.png')});
    await page.evaluate(()=>page('home'));
    const title=(await api('/sessions')).body.sessions.find(session=>session.sessionId===sessionId).title;
    await page.getByRole('main').getByRole('button',{name:`更多操作 ${title}`,exact:true}).click();
    await page.getByRole('button',{name:'移至项目',exact:true}).click();await page.getByRole('dialog',{name:'移至项目',exact:true}).waitFor();
    await page.screenshot({path:join(evidence,'mobile-bundle-move-project.png')});
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(done=>server.close(done));}
}
