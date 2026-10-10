import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = process.env.FX19_REPOSITORY || resolve(import.meta.dirname, '../../../..');
app.getAppPath = () => repository;
globalThis.__fx19Trace = [];
globalThis.__fx19Record = (stage, start) => globalThis.__fx19Trace.push({ stage, at: Date.now(), ms: performance.now() - start });
globalThis.__fx19Wrap = (stage, fn) => function(...args) {
  const start = performance.now();
  try { const value = fn.apply(this, args); if (value?.then) return value.finally(() => globalThis.__fx19Record(stage, start)); globalThis.__fx19Record(stage, start); return value; }
  catch (e) { globalThis.__fx19Record(stage, start); throw e; }
};
registerHooks({ load(url, context, next) {
  if (!url.startsWith(pathToFileURL(repository + '/src/').href)) return next(url, context);
  let source = readFileSync(new URL(url), 'utf8');
  if (url.endsWith('/personal-access/index.mjs')) {
    source = source.replace('  return service;', '  globalThis.__fx16Mutate=(owner,rows)=>serial(()=>mutate(owner,next=>Object.assign(next.sessions,rows)));\n  return service;');
    source = source.replace('const next = structuredClone(rootState);', 'let fx19t=performance.now(); const next = structuredClone(rootState); globalThis.__fx19Record("state.clone",fx19t); fx19t=performance.now();');
    source = source.replace('    validateStore(next);', '    globalThis.__fx19Record("state.change-reconcile",fx19t); fx19t=performance.now(); validateStore(next); globalThis.__fx19Record("state.validate",fx19t);');
  }
  if (url.endsWith('/personal-access/store.mjs')) {
    source = source.replace('  const releaseWrite = await enterProfileWrite(file);', '  const fx19t=performance.now(); const releaseWrite = await enterProfileWrite(file);');
    source = source.replace("await handle.writeFile(JSON.stringify(state), 'utf8');", 'const st=performance.now(); const bytes=JSON.stringify(state); globalThis.__fx19Record("store.serialize",st); await handle.writeFile(bytes, "utf8");');
    source = source.replace('    releaseWrite();', '    releaseWrite(); globalThis.__fx19Record("store.durable",fx19t);');
  }
  if (url.endsWith('/personal-access-backend.mjs')) source = source.replace('  const requireRuntime =', `  {const original=gateway;gateway=(path,...args)=>globalThis.__fx19Wrap('native.'+(args[0]?.method||'GET')+' '+path.replace(/session-[a-f0-9-]+/g,':id'),original)(path,...args);} listSessions=globalThis.__fx19Wrap('native.list',listSessions); bindSession=globalThis.__fx19Wrap('binding.write',bindSession); profiles=globalThis.__fx19Wrap('binding.profiles',profiles);\n  const requireRuntime =`);
  if (url.endsWith('/dsh-web-runtime.ts')) source=source.replace('      const child = spawn(spec.command, args, {', `      args.unshift('--import', ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname,'child-hooks.mjs')).href)}); env.FX19_CHILD_TRACE=process.env.FX19_CHILD_TRACE;\n      const child = globalThis.__fx19Child = spawn(spec.command, args, {`);
  if (url.endsWith('/main.mjs')) source = source.replace('  const accessBackend =', `  globalThis.__fx16NativeCreate=async({ownerId,modelProfileId,count,offset})=>{const entries={};const seedSettings=settingsMod.snapshotSettings();seedSettings.sessionBindings ||= {};const cwdRoot=join(userDataDir,'fx19-native-seeds');for(let chunk=0;chunk<count;chunk+=20)await Promise.all(Array.from({length:Math.min(20,count-chunk)},async(_,j)=>{const i=chunk+j;const sessionId='session-'+randomUUID(),cwd=join(cwdRoot,sessionId);mkdirSync(cwd,{recursive:true});await stageOneGateway('/sessions',{method:'POST',body:JSON.stringify({sessionId,agentPreset:'personal-remote',cwd})});seedSettings.sessionBindings[sessionId]={profileId:modelProfileId,restoreInternalRoute:true};entries[sessionId]={ownerId,origin:'personal-remote',modelProfileId,title:'原生合成会话 '+(offset+i),attachedAt:new Date().toISOString()};}));settingsMod.restoreSettings(seedSettings);await globalThis.__fx16Mutate(ownerId,entries);return Object.keys(entries).length;};\n  const accessBackend =`);
  return { ...next(url, context), source, shortCircuit: true };
}});
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
