/* Local-only, deliberately lossy JavaScript diagnostics. No messages or raw stacks. */
globalThis.WeftLocalDiagnostics = (() => {
    const key='weftmate.mobile.diagnostics.v1', retentionDays=7, maxBytes=16*1024, maxRecords=20;
    const names=new Set(['Error','EvalError','RangeError','ReferenceError','SyntaxError','TypeError','URIError','AggregateError','DOMException','AbortError']);
    // Only first-party entry scripts can contribute a location. URL identity is
    // checked before reducing it to this fixed filename set.
    const scripts=new Set(['app.js','system-bars.js','layout.js','motion.js','timeline.js','cloud-login.js','cloud-native.js',
        'folder-choice.js','composer-subtasks.js','next-suggestions.js','popovers.js','icons.js','conversation-scroll.js',
        'components/local-diagnostics.js','components/presence.js','components/chat.js','components/sessions.js',
        'components/main-chat-registry.js','components/main-chat.js','components/main-chat-mobile.js','components/memory.js',
        'components/usage.js','components/usage-view.js','components/schedules-view.js','components/question-bar.js',
        'components/settings-controls.js','components/notifications.js','components/personalization.js','components/settings.js',
        'components/resources.js','components/decisions.js','components/cloud-auth.js','components/cloud-settings.js',
        'components/cloud-account.js','components/help-view.js','components/search-view.js','components/library-view.js',
        'components/activity-view.js','components/goals-view.js','components/offline.js']);
    for(const path of ['store.js','rendering.js','reply-motion.js','shortcuts.js','release-notes.js','help.js','personalization.js',
        'onboarding-copy.js','offline.js','auth.js','shell.js','presence.js','settings.js','backup.js','data.js','account.js','memory.js',
        'attachments.js','sessions.js','messages.js','message-actions.js','approvals.js','tasks.js','questions.js','resources.js','phone.js',
        'composer.js','timeline-model.js','subtasks.js','appearance.js','settings-registry.js','client.js','cloud-auth.js','cloud-account.js',
        'usage.js','update.js','schedules.js','chat-window.js','main-chat.js','activity.js','goals.js','library.js','search.js','next-suggestions.js',
        'adapters/android-bridge.js','adapters/mobile-web.js','adapters/mobile.js','adapters/mobile-host.js','adapters/mobile-decisions.js',
        'adapters/mobile-settings.js'])scripts.add('ui-core/'+path);
    const basenames=new Set([...scripts].map(path=>path.split('/').pop()));
    const runId=globalThis.crypto?.randomUUID?.() || `web-${Date.now().toString(16)}`;
    const startedAt=new Date().toISOString(); let recordIndex=0, nativeCall=null, memory=[], storageAvailable=true;
    const integer=value=>Number.isInteger(value)&&value>0&&value<=1000000?value:undefined;
    function location(filename,line,column,base=globalThis.location?.href) {
        try {
            if(typeof filename!=='string'||!base)return {};
            const root=new URL('.',base),url=new URL(filename,base);
            if(url.origin!==root.origin||url.username||url.password||!url.pathname.startsWith(root.pathname))return {};
            const path=url.pathname.slice(root.pathname.length);
            if(!scripts.has(path))return {};
            return {script:path.split('/').pop(),line:integer(line),column:integer(column)};
        } catch { return {}; }
    }
    function sanitize(value={}) {
        const clean={source:value.source==='web-rejection'?'web-rejection':'web-error',name:names.has(value.name)?value.name:'Error'};
        if(basenames.has(value.script)){clean.script=value.script;if(integer(value.line))clean.line=value.line;if(integer(value.column))clean.column=value.column;}
        return clean;
    }
    function fromEvent(event,source) {
        let error,place={};
        try {
            error=source==='web-rejection'?event.reason:event.error;
            if(source==='web-error')place=location(event.filename,event.lineno,event.colno);
            else if(typeof error?.stack==='string') {
                // Inspect a bounded stack only to extract a trusted script location;
                // the text itself is never retained or sent through the bridge.
                for(const line of error.stack.slice(0,4096).split('\n').slice(1,9)){
                    const match=line.match(/((?:https?:\/\/|file:\/\/)[^\s()]+):(\d+):(\d+)\)?$/);
                    if(match){place=location(match[1],Number(match[2]),Number(match[3]));if(place.script)break;}
                }
            }
            return sanitize({source,name:error?.name,...place});
        } catch { return sanitize({source}); }
    }
    function prune(records,now=Date.now()) {
        const clean=[];
        for(const item of Array.isArray(records)?records:[]){
            if(!item||typeof item.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.at))continue;
            const at=Date.parse(item.at);if(!Number.isFinite(at)||at<now-retentionDays*86400000||at>now)continue;
            if(typeof item.runId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.runId)||/^web-[0-9a-f]{1,16}$/.test(item.runId)))continue;
            if(!Number.isSafeInteger(item.recordIndex)||item.recordIndex<1)continue;
            clean.push({at:item.at,event:'app.failure',runId:item.runId,recordIndex:item.recordIndex,...sanitize(item)});
        }
        const recent=clean.slice(-maxRecords);
        while(recent.length&&new TextEncoder().encode(JSON.stringify(recent)).length>maxBytes)recent.shift();
        return recent;
    }
    function read() {
        if(!storageAvailable){memory=prune(memory);return memory;}
        try{memory=prune(JSON.parse(globalThis.localStorage.getItem(key)||'[]'));globalThis.localStorage.setItem(key,JSON.stringify(memory));}
        catch{storageAvailable=false;memory=prune(memory);}
        return memory;
    }
    function record(value) {
        const clean=sanitize(value);
        if(globalThis.weftNative){
            if(nativeCall)void Promise.resolve().then(()=>nativeCall('diagnostics.record',clean)).catch(()=>{});
            else try{globalThis.weftNative.postMessage(JSON.stringify({id:`diag${++recordIndex}`,method:'diagnostics.record',params:clean}));}catch{}
            return;
        }
        const records=read();memory=prune([...records,{at:new Date().toISOString(),event:'app.failure',runId,recordIndex:++recordIndex,...clean}]);
        try{if(storageAvailable)globalThis.localStorage.setItem(key,JSON.stringify(memory));}catch{storageAvailable=false;}
    }
    function status() {
        const records=read(),counts={'app.failure':records.length};
        const recentAbnormalRecords=records.map(({at,event,runId,...record})=>({at,event,runId,platform:'mobile-web',appVersion:'unknown',osVersion:'browser',
            fields:Object.fromEntries(Object.entries(record).map(([key,value])=>[key,String(value)]))}));
        const summary={platform:'mobile-web',appVersion:'unknown',osVersion:'browser',generatedAt:new Date().toISOString(),
            recentAbnormalRecords,abnormalCountsLast7Days:counts,retentionPolicy:{retentionDays,maxBytes}};
        const describe=item=>`${new Date(item.at).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${item.name}${item.script?' · '+item.script+(item.line?':'+item.line:'')+(item.column?':'+item.column:''):''}`;
        return {state:'ready',startedAt,previous:null,uncleanCount7Days:0,abnormalCountsLast7Days:counts,records,
            summary:JSON.stringify(summary,null,2),summaryPreview:`本机浏览器运行记录\n最近 7 天保留的异常：${records.length} 条\n保留最近 20 条，最多 16 KB\n${records.map(describe).join('\n')||'没有异常记录。'}`};
    }
    return {configure:call=>{nativeCall=call;},sanitize,fromEvent,location,prune,record,status};
})();
// Install before the application entry point so startup and runtime failures
// both reach the same privacy boundary. Boot-failure reporting remains separate.
globalThis.addEventListener('error',event=>{WeftLocalDiagnostics.record(WeftLocalDiagnostics.fromEvent(event,'web-error'));event.preventDefault?.();});
globalThis.addEventListener('unhandledrejection',event=>{WeftLocalDiagnostics.record(WeftLocalDiagnostics.fromEvent(event,'web-rejection'));event.preventDefault?.();});
