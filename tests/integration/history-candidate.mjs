import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
/** Ordinary conversation with a long synthetic history. */
export async function startHistoryCandidate(count=300,{logicalMobile=false}={}) {
  const fixture=await startTimelineCandidate({daily:true,sidebar:true,logicalMobile,inlineProgress:true,interactive:true,historyCount:0,baseTime:Date.now()-15000});
  try {
    const {sessionId}=await fixture.startChat('合成历史对话');
    fixture.seedMainHistory(sessionId,count);
    return {...fixture, historySessionId:sessionId};
  } catch(error){await fixture.close();throw error;}
}
