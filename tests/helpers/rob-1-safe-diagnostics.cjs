// Fixed safe metadata only. Never forward arbitrary errors or child output.
const get=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
const choice=(value,allowed)=>allowed.includes(value)?value:'unknown';
const number=(value,max=180000,min=0)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,Math.trunc(value))):null;
const boolean=value=>typeof value==='boolean'?value:null;
const codes=['none','unknown','EACCES','EPERM','ENOENT','EIO','EINVAL','ENOSPC','ETIMEDOUT','ENOBUFS','EAGAIN','ENOMEM'];
function safeReadiness(value){
 if(!value)return null;
 const read=key=>get(value,key),result={version:read('version')===1?1:0,
  phase:choice(read('phase'),['availability','probe','local-state-read','local-state-parse','proof-child','proof-auth','local-state-open','local-state-fsync','local-state-close','complete']),
  outcome:choice(read('outcome'),['ready','deadline','exception']),
  lastAvailability:boolean(read('lastAvailability')),probeCreated:boolean(read('probeCreated')),
  probeVersion:choice(read('probeVersion'),['not-checked','v10','other']),
  localState:choice(read('localState'),['not-read','string-key','missing-key','non-string-key','read-error','parse-or-shape-error']),
  childStatus:number(read('childStatus'),4294967295,-2147483648),
  childSignal:read('childSignal')===null?null:choice(read('childSignal'),['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBREAK']),
  childError:choice(read('childError'),codes),childTimedOut:boolean(read('childTimedOut')),
  authResult:choice(read('authResult'),['not-attempted','matched','mismatched','failed']),
  fsyncAttempted:boolean(read('fsyncAttempted')),fsyncSucceeded:boolean(read('fsyncSucceeded')),
  closeAttempted:boolean(read('closeAttempted')),closeSucceeded:boolean(read('closeSucceeded')),
  exceptionCode:choice(read('exceptionCode'),codes)};
 for(const key of ['elapsedMs','childTimeoutMs','childElapsedMs'])result[key]=number(read(key));
 for(const key of ['availabilityChecks','proofAttempts'])result[key]=number(read(key),100000);
 for(const key of ['childStdoutBytes','childStderrBytes'])result[key]=number(read(key),16777216);
 return result;
}
function safeVersions(value){
 const version=key=>{const raw=get(value,key),match=typeof raw==='string'&&/^(\d+)\.(\d+)\.(\d+)(?:$|-)/.exec(raw);return match?match.slice(1).map(part=>number(Number(part),100000)):null;};
 return {electron:version('electron'),node:version('node')};
}
function safeFixtureFailure(error,context={}){
 return {stage:'fixture-failure',action:choice(get(context,'action'),['readiness-race','read','refill','normal','crash','kill','power-cut']),
  timing:choice(get(context,'timing'),['none','before','during','after']),
  fixturePhase:choice(get(context,'fixturePhase'),['app-ready','module-load','initialize','save','read','assert','complete']),
  name:choice(get(error,'name'),['Error','TypeError','RangeError','AssertionError']),
  code:choice(get(error,'code'),['CREDENTIAL_STORAGE_NOT_READY','CREDENTIAL_VAULT_UNREADABLE','ERR_ASSERTION',...codes]),
  readiness:safeReadiness(get(context,'readiness')),versions:safeVersions(get(context,'versions'))};
}
function reportFixtureFailure(error,context,output){
 const report=safeFixtureFailure(error,context);
 try{
  // An unavailable diagnostics pipe cannot replace the original fixture exit.
  output.once?.('error',()=>{});
  output.write(JSON.stringify(report)+'\n',()=>{});
 }catch{}
 return report;
}
module.exports={safeReadiness,safeVersions,safeFixtureFailure,reportFixtureFailure};
