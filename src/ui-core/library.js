/* Shared account-scoped file library; output provenance stays in the host. */
globalThis.WeftUiCore.factories.library=(core,effects)=>{
    const model={items:[],projects:[],type:'',projectId:'',time:'all',search:'',view:'list',nextCursor:null,total:0,loading:false,error:'',generation:0};
    let identity,flight;
    const scope=()=>`${core.state.identityGeneration}:${core.state.account?.ownerId??core.state.ownerId}`;
    function resetLibrary(){model.generation++;Object.assign(model,{items:[],projects:[],type:'',projectId:'',time:'all',search:'',nextCursor:null,total:0,loading:false,error:''});flight=null;effects.clearLibraryPreview?.();effects.renderLibrary?.();}
    async function readLibrary(more=false){
        effects.syncLibraryIdentity?.();if(identity!==scope()){identity=scope();resetLibrary();}
        if(core.state.personalCapabilities?.library!==1)return;
        if(flight)return flight;
        if(!more)model.after=model.time==='all'?null:new Date(Date.now()-Number(model.time)*86400000).toISOString();
        const token=scope(),generation=model.generation,params=new URLSearchParams({limit:'50'});
        for(const key of ['type','projectId','search'])if(model[key])params.set(key,model[key]);
        if(model.after)params.set('after',model.after);
        if(more&&model.nextCursor)params.set('cursor',model.nextCursor);
        model.loading=true;effects.renderLibrary?.();
        const work=(async()=>{try{const page=await core.accessApi(`/library?${params}`);if(token!==scope()||generation!==model.generation)return;
            model.items=more?[...model.items,...page.items]:page.items;Object.assign(model,{projects:page.projects,nextCursor:page.nextCursor,total:page.total,error:''});
        }catch(error){if(token===scope()&&generation===model.generation)model.error=error.status===409?'成果已更新，请刷新。':core.failureMessage(error);}
        finally{if(token===scope()&&generation===model.generation){model.loading=false;effects.renderLibrary?.();}if(flight===work)flight=null;}})();flight=work;return work;
    }
    async function setLibraryFilter(key,value){if(!['type','projectId','time','search'].includes(key))return;model[key]=value;model.generation++;model.items=[];model.nextCursor=null;flight=null;await readLibrary();}
    async function libraryPreview(item){const token=scope(),generation=model.generation;const data=await core.accessApi(`/library/${encodeURIComponent(item.id)}/preview`);if(token!==scope()||generation!==model.generation)throw {code:'STALE_CONTEXT'};return data;}
    async function openLibrarySource(item){const token=scope();const detail=await core.accessApi(`/library/${encodeURIComponent(item.id)}`);if(token!==scope())return;await effects.openLibrarySource?.(detail.item.source);}
    return {library:model,readLibrary,setLibraryFilter,libraryPreview,openLibrarySource,resetLibrary};
};
