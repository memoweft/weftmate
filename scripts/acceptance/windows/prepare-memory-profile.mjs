// Extra independent first trials use the same verified installed executable.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT} from '../../../src/host-mode.mjs';
const [installationRoot,outputRoot]=process.argv.slice(2);
if(!installationRoot||!outputRoot)throw Error('Usage: prepare-memory-profile.mjs INSTALLED_EVIDENCE NEW_OUTPUT');
const original=JSON.parse(await readFile(join(resolve(installationRoot),'installation.json'),'utf8'));
if(!original.exeExists||original.developmentHost)throw Error('A verified installed candidate is required');
const root=resolve(outputRoot),profile=join(root,'profile'),desktopConfig=join(root,'desktop-config.json');
await mkdir(root,{recursive:true});await mkdir(profile); // existing profile is a hard error
await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT),{flag:'wx'});
await writeFile(desktopConfig,JSON.stringify({schemaVersion:1,dataDirectory:profile,accessPort:0,production:{relayEnabled:false,acmeEnabled:false},updates:{channel:'preview'}},null,2),{flag:'wx'});
await writeFile(join(root,'installation.json'),JSON.stringify({...original,profile,control:desktopConfig,desktopConfig,relay:false,environment:'fresh memory trial profile using the same installed candidate',additionalProfile:true},null,2),{flag:'wx'});
console.log(JSON.stringify({freshProfile:true,sameInstalledExecutable:true}));
