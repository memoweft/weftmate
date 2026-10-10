import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {startTimelineCandidate} from './timeline-ui-candidate.mjs';
import {renderingSample,userSample} from '../helpers/rendering-sample.mjs';
export async function startRenderingCandidate(){
  const fixture=await startTimelineCandidate({interactive:true,daily:true,inlineProgress:true,sidebar:true,historyCount:0,libraryNativeActions:async input=>({opened:true})});
  fixture.progress.finish();
  const source=await fixture.newOutputSource(userSample);
  await fixture.request(`/sessions/${source.sessionId}/metadata`,{title:'渲染样张'},'PATCH');
  const files=join(fixture.root,'ux5-files');await mkdir(files);
  const artifacts=[];
  for(const [name,text]of [['渲染样张.md',renderingSample],['合成报告.docx','Synthetic Office fixture'],['合成表格.xlsx','Synthetic Office fixture'],['合成演示.pptx','Synthetic Office fixture']]){
    const path=join(files,name);await writeFile(path,text);artifacts.push(await fixture.registerOutput(path,source));
  }
  fixture.progress.text(renderingSample);fixture.finishOutputSource(source);
  return {...fixture,renderingSource:source,artifacts};
}
