import assert from 'node:assert/strict';

// Answer the actual phone card, retaining the approval id and once-only scope.
// Geometry and hit testing fail if the composer or another surface covers it.
export async function approvePhoneOperation(page, row, beforeSubmit = async () => {}) {
  const card=page.locator(`[data-conversation-approval="${row.approvalId}"]`);
  await card.waitFor();
  assert.equal(await card.evaluate(node=>!!node.closest('#chat-scroll')),true);
  const entry=page.locator('#phone-pending-decision');
  const offscreen=await card.evaluate(node=>{const a=node.getBoundingClientRect(),b=node.closest('#chat-scroll').getBoundingClientRect();return a.bottom<=b.top||a.top>=b.bottom;});
  if(offscreen){await entry.waitFor();await entry.click();}
  let action;
  if(row.canAlwaysAllow){
    const once=card.getByRole('radio',{name:'仅这一次',exact:true});
    await once.click();assert.equal(await once.getAttribute('aria-checked'),'true');
    await card.getByRole('radio',{name:'以后这类都允许',exact:true}).waitFor();
    await card.getByRole('radio',{name:'拒绝',exact:true}).waitFor();
    action=card.getByRole('button',{name:'确认',exact:true});
  }else{
    await card.getByRole('button',{name:'拒绝',exact:true}).waitFor();
    action=card.getByRole('button',{name:'批准',exact:true});
  }
  await action.waitFor();await action.scrollIntoViewIfNeeded();
  assert.equal(await action.isEnabled(),true);
  const geometry=await action.evaluate(node=>{
    const box=node.getBoundingClientRect(),scroll=node.closest('#chat-scroll').getBoundingClientRect(),composer=document.getElementById('message-form').getBoundingClientRect();
    const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    return {top:box.top,bottom:box.bottom,height:box.height,scrollTop:scroll.top,scrollBottom:scroll.bottom,composerTop:composer.top,uncovered:hit===node||node.contains(hit)};
  });
  assert.ok(geometry.height>=44,'phone approval action retains a 44px touch target');
  assert.ok(geometry.top>=geometry.scrollTop&&geometry.bottom<=geometry.scrollBottom&&geometry.bottom<=geometry.composerTop,'phone approval must be inside the conversation above the composer');
  assert.equal(geometry.uncovered,true,'phone approval action must not be covered');
  await beforeSubmit(geometry);await action.click();return geometry;
}
