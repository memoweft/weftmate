import {app} from 'electron';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'../../../..');app.getAppPath=()=>repository;
registerHooks({load(url,context,next){
 if(url.endsWith('/src/personal-access/index.mjs')){const source=readFileSync(new URL(url),'utf8').replace('  return service;','  globalThis.__fx16Mutate=(owner,rows)=>serial(()=>mutate(owner,next=>Object.assign(next.sessions,rows)));\n  return service;');return {format:'module',source,shortCircuit:true};}
 if(url.endsWith('/src/main.mjs')){const source=readFileSync(new URL(url),'utf8').replace('  const accessBackend =',`  globalThis.__fx16NativeCreate=async({ownerId,modelProfileId,count,offset})=>{const entries={};const seedSettings=settingsMod.snapshotSettings();seedSettings.sessionBindings ||= {};const cwdRoot=join(userDataDir,'fx16-native-seeds');for(let i=0;i<count;i++){const sessionId='session-'+randomUUID(),cwd=join(cwdRoot,sessionId);mkdirSync(cwd,{recursive:true});await stageOneGateway('/sessions',{method:'POST',body:JSON.stringify({sessionId,agentPreset:'personal-remote',cwd})});seedSettings.sessionBindings[sessionId]={profileId:modelProfileId,restoreInternalRoute:true};entries[sessionId]={ownerId,origin:'personal-remote',modelProfileId,title:'原生合成会话 '+(offset+i),attachedAt:new Date().toISOString()};}settingsMod.restoreSettings(seedSettings);await globalThis.__fx16Mutate(ownerId,entries);return Object.keys(entries).length;};
  const accessBackend =`);return {format:'module',source,shortCircuit:true};}
 return next(url,context);
}});
await import(pathToFileURL(resolve(repository,'src/main.mjs')).href);
