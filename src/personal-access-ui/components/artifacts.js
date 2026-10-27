/* Per-turn output summary; the shared renderer also serves the phone. */
(() => {
    function artifactCard(row, data, options) {
        const saved = { expanded: row.querySelector('.artifact-summary')?.dataset.expanded === 'true' };
        row.replaceChildren(globalThis.WeftContent.artifactSummary(data.artifacts || [data], options, saved));
    }
    function changes(events) {
        const files=new Map(), calls=new Set();
        for(const event of events) {
            const step=event.type==='artifact.created'?event.data.completedStep:event.type==='step.completed'?event.data:null;
            if(!step || step.state!=='completed' || calls.has(`${step.taskId}/${step.stepId}`))continue;
            calls.add(`${step.taskId}/${step.stepId}`);
            for(const change of step.fileChanges || []) {
                const file=files.get(change.path) || {...change,added:0,removed:0,steps:[]};
                if(file.added===null || change.added===null){file.added=null;file.removed=null;}
                else {file.added+=change.added;file.removed+=change.removed;}
                file.steps.push({...step,sessionId:event.sourceRef?.sessionId || event.sessionId});files.set(change.path,file);
            }
        }
        return [...files.values()];
    }
    function changeCard(row, files, options) {
        row.classList.add('file-changes');row.setAttribute('aria-label','本轮文件改动');
        const signature=JSON.stringify(files);if(row.dataset.changes===signature)return;
        row.dataset.changes=signature;
        row.replaceChildren();
        for(const file of files) {
            const line=document.createElement('div');line.className='file-change-row';
            const name=document.createElement('span');name.className='file-change-name';name.textContent=file.path.split(/[\\/]/).at(-1);name.title=file.path;
            const icon=document.createElement('span');icon.className='file-change-icon';icon.append(WeftIcons.create('file',16));
            const copy=document.createElement('div');copy.className='file-change-copy';
            const title=document.createElement('div');title.className='file-change-title';
            const verb=document.createElement('span');verb.className='file-change-verb';verb.textContent='已编辑';title.append(verb,name);
            const counts=document.createElement('span');counts.className='file-change-counts';
            if(file.added===null)counts.textContent='行数未记录';
            else {const add=document.createElement('span'),remove=document.createElement('span');add.className='change-added';remove.className='change-removed';add.textContent=`+${file.added}`;remove.textContent=`−${file.removed}`;counts.append(add,remove);counts.setAttribute('aria-label',`增加 ${file.added} 行，删除 ${file.removed} 行`);}
            const review=document.createElement('button');review.type='button';review.className='button secondary small file-change-review';review.textContent='审阅';review.setAttribute('aria-label',`审阅 ${name.textContent}`);review.onclick=()=>options.openChange(file,review);
            copy.append(title,counts);line.append(icon,copy,review);row.append(line);
        }
    }
    globalThis.WeftTimelineCards = { ...globalThis.WeftTimelineCards, artifact: artifactCard, changes, change:changeCard };
})();
