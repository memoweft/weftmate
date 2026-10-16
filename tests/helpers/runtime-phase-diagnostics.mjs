/** Test-only observation seam; callers retain all lifecycle decisions. */
const phases=new Set(['fixture-setup','runtime-create','runtime-start','host-start','account-setup','project-create','direct-write',
  'main-reply','work-switch','normal-approval','history-check','background-route','decline','public-query','overwrite',
  'finally-runtime-close','finally-host-close','finally-links','finally-remove']);
const reasons=new Set(['clean-exit','unexpected-exit','startup-failed']);
const actions=new Set(['awaiting-close','shutdown-confirmed','startup-failed','startup-abandoned','startup-retry-scheduled',
  'respawn-scheduled','respawn-succeeded','respawn-failed','respawn-abandoned']);
const signals=new Set(['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBREAK','SIGHUP']);
const codes=new Set(['ERR_ASSERTION','ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','EACCES','EPERM','ENOENT','EIO','ENOSPC',
  'RUNTIME_UNAVAILABLE','RUNTIME_CLOSED','DSH_CHECKOUT_PREFLIGHT_FAILED','ABORT_ERR']);
const get=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
const choice=(value,values)=>values.has(value)?value:'unknown';
export function createRuntimePhaseDiagnostics({publish=()=>{},now=()=>performance.now()}={}) {
  const clock=()=>{try{const value=now();return typeof value==='number'&&Number.isFinite(value)?value:null;}catch{return null;}};
  const started=clock();
  const emit=record=>{
    try{
      const current=clock(),elapsedMs=current===null||started===null?null:Math.max(0,Math.min(2147483647,Math.trunc(current-started)));
      const result=publish(Object.freeze({version:1,...record,elapsedMs}));
      void Promise.resolve(result).catch(()=>{});
    }catch{/* Observation must never replace a test result, error or cleanup. */}
  };
  return {
    phase(phase,state,error){emit({kind:'phase',phase:choice(phase,phases),state:choice(state,new Set(['start','complete','failed'])),
      errorCode:error===undefined?'none':choice(get(error,'code'),codes)});},
    processEvent(event){
      const raw=get(event,'exitCode'),exitCode=Number.isInteger(raw)&&raw>=-2147483648&&raw<=4294967295?raw:null;
      const exitUnsigned=exitCode===null?null:exitCode>>>0,signal=get(event,'signal');
      emit({kind:'dsh-process',reason:choice(get(event,'reason'),reasons),action:choice(get(event,'action'),actions),exitCode,exitUnsigned,
        exitHex:exitUnsigned===null?null:`0x${exitUnsigned.toString(16).toUpperCase().padStart(8,'0')}`,
        signal:signal===null?null:choice(signal,signals)});
    },
  };
}
