import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
/** Small main-chat gallery fixture, independent of legacy approval/question scenes. */
export async function startMainChatCandidate(count=300,{logicalMobile=false}={}) {
  const fixture=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile,inlineProgress:true,interactive:true,historyCount:0,baseTime:Date.now()-15000});
  try {
    const main=(await fixture.request('/chats/main')).chat,host=(await fixture.request('/status')).hostId;
    let command=(await fixture.request('/commands',{requestId:randomUUID(),kind:'chat.message',chatId:main.chatId,targetDeviceId:host,modelProfileId:'local',text:'合成主对话'})).command;
    while(command.state!=='accepted_by_dsh'){await new Promise(done=>setTimeout(done,20));command=(await fixture.request(`/commands/${command.commandId}`)).command;assert.notEqual(command.state,'rejected');}
    fixture.seedMainHistory(command.sessionId,count);return fixture;
  } catch(error){await fixture.close();throw error;}
}
