import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
const inspector = new Session(); inspector.connect();
process.on('message', message => {
  if (message?.fx19 === 'profile-start') inspector.post('Profiler.enable', () => inspector.post('Profiler.start'));
  if (message?.fx19 === 'profile-stop') inspector.post('Profiler.stop', (error, result) => {
    if (!error) writeFileSync(process.env.FX19_CHILD_TRACE+'.cpuprofile', JSON.stringify(result.profile));
  });
});
globalThis.__fx19Native = (stage, start) => appendFileSync(process.env.FX19_CHILD_TRACE, JSON.stringify({ stage, at: Date.now(), ms: performance.now()-start })+'\n');
registerHooks({load(url,context,next){
  if (!url.endsWith('/dsh-adapter/session-lifecycle.mjs') && !url.endsWith('/dsh-adapter/sessions.mjs')) return next(url,context);
  let source=readFileSync(new URL(url),'utf8');
  if(url.endsWith('/session-lifecycle.mjs')) {
    source=source.replace('    const sessionId = options.sessionId', '    const fx19Start=performance.now(); const sessionId = options.sessionId');
    source=source.replace('    const setup = async agentCtx => {','    globalThis.__fx19Native("preset.resolve",fx19Start); const setup = async agentCtx => { const t=performance.now();');
    source=source.replace("      agentCtx.on('agent/pre-step'", "      globalThis.__fx19Native('preset.mount',t); agentCtx.on('agent/pre-step'");
    source=source.replace('    const handle = resume','    const fx19Agent=performance.now(); const handle = resume');
    source=source.replace('    handles.set(sessionId, handle)','    globalThis.__fx19Native(resume?"agent.resume":"agent.create",fx19Agent); handles.set(sessionId, handle)');
  } else {
    source=source.replace("      const value = await unwrap(await client.sessions.create(options), 'create')", "      const fx19Rpc=performance.now(); const value = await unwrap(await client.sessions.create(options), 'create'); globalThis.__fx19Native('client.sessions.create',fx19Rpc)");
  }
  return {...next(url,context),source,shortCircuit:true};
}});
