/* Runtime observations, not timing assertions. Save only to a caller-owned evidence path. */
export async function measureUi(page, name, action, ready) {
  await page.evaluate(ready => {
    const sample = { frames: [], tasks: [], shifts: [], inputAt:null, firstPaintMs:null, feedbackMs:null, ready };
    const input = () => { sample.inputAt ??= performance.now(); };
    document.addEventListener('pointerdown',input,true); document.addEventListener('keydown',input,true); document.addEventListener('wheel',input,{capture:true,passive:true});
    const observers = [];
    for (const type of ['longtask','layout-shift']) if (PerformanceObserver.supportedEntryTypes.includes(type)) {
      const observer = new PerformanceObserver(list => { for(const entry of list.getEntries()) {
        if (type === 'longtask') sample.tasks.push({at:entry.startTime,duration:entry.duration});
        else sample.shifts.push({at:entry.startTime,value:entry.value,recentInput:entry.hadRecentInput});
      }}); observer.observe({type,buffered:false});observers.push(observer);
    }
    const visible = () => {
      if (ready.kind === 'panel') return !!document.querySelector('.timeline-preview:not([hidden])') === ready.visible;
      if (ready.kind === 'parallelStream') return document.querySelector('#transcript')?.textContent.includes('主线流式') && document.querySelector('.panel-chat .transcript')?.textContent.includes('侧聊流式');
      if (ready.kind === 'tab') return document.querySelector('.preview-tab-select[aria-selected=true]')?.textContent === ready.title;
      if (ready.kind === 'width') return Math.abs(document.querySelector('.timeline-preview').getBoundingClientRect().width - ready.before) > 2;
      if (ready.kind === 'conversation') return testCore.state.selectedSessionId === ready.id && !testCore.state.newConversation && document.getElementById('transcript').textContent.includes('报告已保存');
      if (ready.kind === 'conversation-anchor') {
        const row = [...document.querySelectorAll('#transcript > [data-event-id]')].find(row => row.dataset.eventId === ready.key);
        return testCore.state.selectedSessionId === ready.id && row && Math.abs(row.getBoundingClientRect().top - document.getElementById('chat-scroll').getBoundingClientRect().top - ready.offset) < 2;
      }
      if (ready.kind === 'draft') return testCore.state.newConversation;
      if (ready.kind === 'scroll') return document.getElementById('session-list').scrollTop !== ready.before;
      return true;
    };
    let previous, frame;
    const tick = now => {
      if (sample.inputAt !== null) {
        if(previous!==undefined)sample.frames.push(now-previous);
        sample.firstPaintMs ??= performance.now()-sample.inputAt;
        if(visible())sample.feedbackMs ??= performance.now()-sample.inputAt;
      }
      previous=now;frame=requestAnimationFrame(tick);
    };frame=requestAnimationFrame(tick);
    globalThis.finishUiSample = async () => {
      // Observe the same 750ms window after the first actual input event.
      const inputDeadline=performance.now()+1000;while(sample.inputAt===null&&performance.now()<inputDeadline)await new Promise(resolve=>setTimeout(resolve,16));
      if(sample.inputAt===null)throw Error('No input event observed');
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,750-(performance.now()-sample.inputAt))));
      cancelAnimationFrame(frame);observers.forEach(observer=>observer.disconnect());
      document.removeEventListener('pointerdown',input,true);document.removeEventListener('keydown',input,true);document.removeEventListener('wheel',input,true);
      const sorted=sample.frames.toSorted((a,b)=>a-b),tasks=sample.tasks.filter(row=>row.at>=sample.inputAt),shifts=sample.shifts.filter(row=>row.at>=sample.inputAt);
      return { windowMs:750,longTasksSupported:PerformanceObserver.supportedEntryTypes.includes('longtask'),layoutShiftsSupported:PerformanceObserver.supportedEntryTypes.includes('layout-shift'),frames:sorted.length,frameP95Ms:sorted[Math.floor((sorted.length-1)*.95)]??null,frameMaxMs:sorted.at(-1)??null,
        longTaskCount:tasks.length,longTaskMaxMs:tasks.length?Math.max(...tasks.map(row=>row.duration)):0,
        cls:shifts.filter(row=>!row.recentInput).reduce((sum,row)=>sum+row.value,0),allLayoutShift:shifts.reduce((sum,row)=>sum+row.value,0),
        firstPaintMs:sample.firstPaintMs,feedbackMs:sample.feedbackMs };
    };
  },ready);
  await action();
  const sample=await page.evaluate(()=>finishUiSample());
  if(sample.frames<20||sample.feedbackMs===null)throw Error(`No representative visual feedback for ${name}: ${JSON.stringify(sample)}`);
  return { name,...sample };
}
