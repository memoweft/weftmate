/** Correct only the synthetic fixture's transport metadata; never seed or edit Core memory. */
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { modelRouteFingerprint } from '../../src/model-route-fingerprint.mjs';
export async function prepareSyntheticMainRoute(root){
 if(dirname(resolve(root)).toLowerCase()!==resolve(tmpdir()).toLowerCase()||!basename(root).startsWith('weftmate-mem1-')||(await lstat(join(root,'profile'))).isSymbolicLink())throw Error('Synthetic MEM-1 profile required');
 const storeFile=join(root,'profile/personal-access/store.json'),settingsFile=join(root,'profile/weftmate-settings.json');
 const store=JSON.parse(await readFile(storeFile,'utf8')),settings=JSON.parse(await readFile(settingsFile,'utf8'));
 const account=Object.values(store.accounts).find(a=>a.account?.usernameCanonical==='mem1synthetic');if(!account)throw Error('Synthetic account required');
 const main=account.chatIdentity.chats[account.chatIdentity.mainChatId],segment=account.chatIdentity.segments[main.activeSegmentId];
 const id=account.sessions[segment.sessionId].modelProfileId;
 const profile=settings.models.profiles.find(p=>p.id===id);if(!profile||profile.model!=='mimo-v2.6-flash')throw Error('Synthetic MiMo binding required');
 const runtimeFile=join(root,'profile/dsh-home/settings.yaml'),runtime=yaml.load(await readFile(runtimeFile,'utf8'));
 const alias=`weftmate-${createHash('sha256').update(id).digest('hex').slice(0,24)}`;
 const provider=runtime['llm-pi-ai']?.providers?.[alias];if(!provider||!provider.models?.some(m=>m.id==='mimo-v2.6-flash'))throw Error('Synthetic provider binding required');
 profile.baseUrl='https://api.xiaomimimo.com/v1';profile.modelTier='cloud';
 provider.baseURL=profile.baseUrl;
 for(const model of Object.values(account.accountModels))for(const revision of Object.values(model.revisions))if(revision.profileId===id){revision.baseUrl=profile.baseUrl;revision.routeFingerprint=modelRouteFingerprint(profile.baseUrl+'/chat/completions',profile.model);revision.modelTier='cloud';}
 account.defaultModelProfileId=account.backgroundModelProfileId=id;settings.models.activeId=id;
 await writeFile(storeFile,JSON.stringify(store),{mode:0o600});await writeFile(settingsFile,JSON.stringify(settings),{mode:0o600});await writeFile(runtimeFile,yaml.dump(runtime),{mode:0o600});return id;
}
