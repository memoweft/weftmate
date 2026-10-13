import { spawn } from 'node:child_process';
import { describeExit, redactEvidenceText } from './process-evidence.mjs';

// Preparation and teardown are awaited by hooks. Only run() starts the probe
// budget; a slow synthetic login cannot consume the functional observation.
export function phasedTestProcess(command, args, {env, roots = []} = {}) {
  const startedAt=Date.now();
  const child = spawn(command, args, {env, windowsHide:true, stdio:['ignore','pipe','pipe','ipc']});
  let stdout = '', stderr = '', lastPhase = 'prepare';
  const messages = new Map(), waits = new Map(), stages = [];
  child.stdout.on('data', data=>{stdout += data;}); child.stderr.on('data', data=>{stderr += data;});
  const evidence = () => ({lastPhase, stages, ...describeExit(child.exitCode,child.signalCode),
    stdout:redactEvidenceText(stdout, roots),stderr:redactEvidenceText(stderr, roots)});
  child.on('message', message=>{
    lastPhase=message.phase; stages.push({phase:message.phase,ms:Date.now()-startedAt});
    messages.set(message.phase,message); waits.get(message.phase)?.resolve(message);
  });
  let closed = false;
  const done = new Promise(resolve=>{
    child.once('error', error=>{stderr += error.stack;});
    child.once('close', (code, signal)=>{
      closed = true;
      for(const wait of waits.values()) wait.reject(Error(JSON.stringify(evidence())));
      resolve({code,signal,evidence:evidence()});
    });
  });
  const phase = name => {
    if(messages.has(name))return Promise.resolve(messages.get(name));
    if(closed)return Promise.reject(Error(JSON.stringify(evidence())));
    return new Promise((resolve,reject)=>waits.set(name,{resolve,reject}));
  };
  return {child,done,evidence,ready:()=>phase('ready'),
    async run(timeoutMs){
      const timer=setTimeout(()=>{
        // Playwright and the temp lease install SIGTERM handlers. A probe's
        // hard deadline must collect its controller even if graceful quit stalls.
        child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy();
      },timeoutMs);
      try{child.send({phase:'run'});return await phase('measured');}
      finally{clearTimeout(timer);}
    },
  };
}
