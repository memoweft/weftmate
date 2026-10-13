import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const context=vm.createContext({}); vm.runInContext(readFileSync(resolve(root,'src/ui-core/onboarding-copy.js'),'utf8'),context);
const presets=context.WeftOnboardingCopy.presets.filter(p=>p.id!=='local');
const quote=s=>JSON.stringify(s);
const result='// Generated from src/ui-core/onboarding-copy.js by sync_phone_presets.mjs.\nimport Foundation\nstruct PhoneProviderPreset: Identifiable {\n    let id, name, baseURL, model, help, url: String\n    static let values: [Self] = [\n'+presets.map(p=>'        .init(id:'+quote(p.id)+',name:'+quote(p.name)+',baseURL:'+quote(p.baseUrl)+',model:'+quote(p.modelId)+',help:'+quote(p.help)+',url:'+quote(p.url)+')').join(',\n')+'\n    ]\n}\n';
const path=resolve(root,'apps/apple/iOS/PhoneProviderPreset.swift');
if(process.argv.includes('--check')) { if(readFileSync(path,'utf8')!==result)throw Error('Phone provider presets differ from desktop onboarding'); }
else writeFileSync(path,result);
