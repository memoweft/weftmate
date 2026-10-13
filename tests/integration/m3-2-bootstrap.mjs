// Real production shell and DSH; only the test model key is kept in memory.
import {app} from 'electron';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(import.meta.dirname,'../..');app.getAppPath=()=>repo;
globalThis.m3ModelRequests=0;
const network=globalThis.fetch;
globalThis.fetch=(url,...args)=>{if(String(url).startsWith('https://api.xiaomimimo.com/')&&String(url).includes('chat/completions'))globalThis.m3ModelRequests++;return network(url,...args);};
registerHooks({load(url,context,next){
  if(url===pathToFileURL(resolve(repo,'src/config-store.ts')).href){
    let source='const ephemeralKeys = new Map<string,string>((JSON.parse(process.env.WEFTMATE_M3_CREDENTIAL_IDS || "[]") as string[]).map(id => [id,process.env.WEFTMATE_M3_MODEL_KEY || ""]));\n(globalThis as any).m3CredentialIds = () => [...ephemeralKeys.keys()];\n'+readFileSync(new URL(url),'utf8');
    source=source.replace('return readSecrets().credentials[id] ?? null;','return ephemeralKeys.get(id) ?? readSecrets().credentials[id] ?? null;');
    source=source.replace('encryptedVault().save(id, apiKey);',"if(apiKey===process.env.WEFTMATE_M3_MODEL_KEY)ephemeralKeys.set(id,apiKey);else encryptedVault().save(id,apiKey);");
    source=source.replace('encryptedVault().remove(id);','ephemeralKeys.delete(id);encryptedVault().remove(id);');
    return {format:'module-typescript',source,shortCircuit:true};
  }return next(url,context);
}});
await import(pathToFileURL(resolve(repo,'src/main.mjs')).href);
