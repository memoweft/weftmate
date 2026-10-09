import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const target=pathToFileURL(resolve(import.meta.dirname,'../../src/personal-access/artifacts.mjs')).href;
registerHooks({load(url,context,next){if(url!==target)return next(url,context);return{format:'module',source:readFileSync(new URL(url),'utf8').replace("['password', 'cloud'].includes(device?.authKind)","device?.authKind === 'password'"),shortCircuit:true};}});
