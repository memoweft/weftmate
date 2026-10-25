import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {fixture as cloudFixture} from '../services/cloud/test/identity-helpers.mjs';
import {registration,appDevice,control,refresh,proof} from '../services/cloud/test/app-helpers.mjs';
import {startTimelineCandidate} from './integration/timeline-ui-candidate.mjs';
import {feedbackUiSession} from './helpers/feedback-ui-session.mjs';
import {approvePhoneOperation} from './helpers/phone-approval.mjs';

test('FE-CHAT phone decisions stay in the scroll flow across suggestion refreshes and submit through the original controls', {timeout:90000}, async t=>{
  const evidence=process.env.WEFTMATE_PHONE_APPROVAL_EVIDENCE;if(evidence)await mkdir(evidence,{recursive:true});
  const cloud=await cloudFixture(t);await registration(cloud);
  const desktop=await appDevice(cloud,'synthetic-approval-desktop');
  let mobileAuth:any,mobileCookie:string;
  const host=await startTimelineCandidate({historyCount:0,interactive:true,composer:true,
    cloudIdentity:{issuer:cloud.config.issuer,clientId:'test-native',allowInsecureLoopback:true},
    authenticate:async({service,origin,hostId}:any)=>{
      const nativeResponse=await fetch(origin+'/personal/v1/auth/desktop',{method:'POST',headers:{origin,'content-type':'application/json','x-weftmate-desktop':service.libraryDesktopToken},body:'{}'});
      assert.equal(nativeResponse.status,200);const native:any=await nativeResponse.json(),cookie=nativeResponse.headers.get('set-cookie')!.split(';')[0];
      const nativeApi=async(path:string,body:any)=>{
        const response=await fetch(origin+'/personal/v1'+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':native.csrfToken,'x-weftmate-desktop':service.libraryDesktopToken},body:JSON.stringify(body)});
        assert.ok(response.ok,path+' '+response.status);return response.json() as any;
      };
      const claim=await nativeApi('/cloud/claims',{});await nativeApi('/cloud/binding',{claimId:claim.claimId,accessToken:desktop.tokens.access_token});
      const mobile=await appDevice(cloud,'synthetic-approval-phone-'+randomUUID());
      const connected=(await control(mobile,'/hosts/connect',{hostId})).data;await refresh(mobile,connected.resource);
      const nonce=await nativeApi('/auth/cloud-nonce',{}),url=origin+'/personal/v1/auth/cloud-session';
      const response=await fetch(url,{method:'POST',headers:{origin,'content-type':'application/json',dpop:await proof(mobile,url,mobile.tokens.access_token,{nonce:nonce.nonce})},body:JSON.stringify({accessToken:mobile.tokens.access_token,deviceName:'合成审批手机'})});
      assert.equal(response.status,200);mobileAuth=await response.json();assert.equal(mobileAuth.device.authKind,'cloud');mobileCookie=response.headers.get('set-cookie')!.split(';')[0];
      return {auth:mobileAuth,cookie:mobileCookie};
    }});
  t.after(()=>host.close());
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(10000);
  const errors:string[]=[],writes:{path:string,body:any}[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/(approvals|questions)\/[^/]+$/.test(path))writes.push({path,body:request.postDataJSON()});});
  const source=await readFile('src/personal-access-ui/app.js','utf8');
  await page.route('**/personal/v1/ui/app.js',route=>route.fulfill({contentType:'text/javascript',body:source.replace('ui.loadAttachmentHasher =','globalThis.__approvalUi=ui;ui.loadAttachmentHasher =')}));
  await page.goto(host.origin+'/personal/v1/ui/');
  await feedbackUiSession(page,{...host,mobileAuth,mobileCookie});
  await page.evaluate(async id=>{const core=(globalThis as any).__feedbackSessionCore;await core.selectSession(id);await core.refreshConversationTasks();await core.refreshConversationApprovals();await core.refreshConversationQuestions();},host.sessionId);
  assert.equal(await page.evaluate(()=>(globalThis as any).WeftPhoneUnify.isPhone()),true);
  const row=(await host.request(`/sessions/${host.sessionId}/approvals`)).approvals.find((row:any)=>row.status==='pending');assert.ok(row);
  const card=page.locator(`[data-conversation-approval="${row.approvalId}"]`);await card.waitFor();
  const original=await page.evaluate(()=>{
    const scope=globalThis as any;scope.originalApproval=scope.WeftTimeline.decisionSurface('approval-bar');scope.originalQuestion=scope.WeftTimeline.decisionSurface('question-bar');
    scope.__approvalUi.nextSuggestions.sync();return {approvalId:scope.originalApproval.id,questionId:scope.originalQuestion.id};
  });assert.deepEqual(original,{approvalId:'approval-bar',questionId:'question-bar'});
  // Reuse the relay assertion and hit testing unchanged, including 44px targets.
  await approvePhoneOperation(page,row,async geometry=>{if(evidence){await page.screenshot({path:join(evidence,'approval-phone.png')});await writeFile(join(evidence,'approval-geometry.json'),JSON.stringify(geometry,null,2));}});
  await page.waitForFunction(()=>!(globalThis as any).__feedbackSessionCore.conversationApprovals.operations.size);
  const accepted=(await host.request(`/sessions/${host.sessionId}/approvals`)).approvals.find((item:any)=>item.approvalId===row.approvalId);
  assert.equal(accepted.decisionOutcome,'allowed-once');assert.equal(accepted.decisionScope,'once');
  assert.equal(writes.filter(write=>write.path.endsWith('/approvals/'+row.approvalId)).length,1);
  assert.equal(writes.find(write=>write.path.endsWith('/approvals/'+row.approvalId)).body.outcome,'allowed-once');
  const question=(await host.request(`/sessions/${host.sessionId}/questions`)).questions.find((item:any)=>item.status==='pending');assert.ok(question);
  const bar=page.locator('#question-bar');await bar.waitFor({state:'visible'});
  await page.evaluate(()=>{const scope=globalThis as any;for(let i=0;i<3;i++){scope.__approvalUi.renderConversationApprovals();scope.__approvalUi.renderConversationQuestions();scope.__approvalUi.nextSuggestions.sync();scope.WeftTimeline.placeDecisions();}});
  assert.equal(await bar.evaluate(node=>!!node.closest('#chat-scroll')),true,'the real question also stays in the phone scroll flow');
  assert.equal(await page.locator('#approval-bar').evaluate(node=>!!node.closest('#chat-scroll')),true);
  assert.equal(await page.evaluate(()=>{const scope=globalThis as any;return scope.originalApproval===document.getElementById('approval-bar')&&scope.originalQuestion===document.getElementById('question-bar')&&document.querySelectorAll('#approval-bar').length===1&&document.querySelectorAll('#question-bar').length===1;}),true);
  assert.equal(await page.locator('#next-suggestions').isVisible(),false,'pending questions retain priority over suggestions');
  if(evidence){await bar.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'question-phone.png')});}
  const choice=bar.locator('.question-choice').first();await choice.click();
  const submit=bar.locator('[data-question-control=submit]');if(await submit.isVisible()&&await submit.isEnabled())await submit.click();
  await page.waitForFunction(()=>!(globalThis as any).__feedbackSessionCore.conversationQuestions.operations.size);
  await page.waitForFunction(()=>!(globalThis as any).__approvalUi.byId('question-bar').querySelector('[data-question-control=submit]'));
  const answered=(await host.request(`/sessions/${host.sessionId}/questions`)).questions.find((item:any)=>item.questionRpcId===question.questionRpcId);
  assert.ok(['answered','resolved'].includes(answered.status));
  assert.equal(writes.filter(write=>write.path.endsWith('/questions/'+question.questionRpcId)).length,1);
  assert.deepEqual(writes.find(write=>write.path.endsWith('/questions/'+question.questionRpcId)).body.answer.answers[0].selected,[question.questions[0].options[0].label]);
  assert.equal(await page.evaluate(()=>{const scope=globalThis as any;scope.__approvalUi.nextSuggestions.sync();return scope.originalApproval===document.getElementById('approval-bar')&&scope.originalQuestion===document.getElementById('question-bar')&&!!scope.originalApproval.closest('#chat-scroll')&&!!scope.originalQuestion.closest('#chat-scroll');}),true);
  assert.deepEqual(errors,[]);
});
