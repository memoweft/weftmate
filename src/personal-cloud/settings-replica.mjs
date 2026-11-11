import {failure} from '../personal-access/common.mjs';
import {settingsSnapshot,settingsHeads,mergeSettings} from '../ui-core/settings-replica.mjs';
import {savePersonalizationRows} from '../personal-access/personalization.mjs';

export function createSettingsExchange(context,hostId,authorize,withCodec) {
  return async (request,box) => {
    const identity = authorize(request);
    const {issuer,sub,ownerId,deviceId,keyId} = identity;
    const check = (permission='sessions:read') => {
      const current = authorize(request,permission);
      if (current.ownerId!==ownerId || current.sub!==sub || current.issuer!==issuer ||
          current.keyId!==keyId || current.deviceId!==deviceId) throw failure('UNAUTHORIZED',401);
    };
    return withCodec(issuer,sub,hostId,async codec => {
      let query;
      try {query=await codec.open('settings-request',box);}
      catch {throw failure('SETTINGS_SYNC_INVALID',403);}
      if (query?.deviceId!==deviceId || typeof query.requestId!=='string' || !/^[\w-]{16,64}$/.test(query.requestId)) throw failure('SETTINGS_SYNC_INVALID',403);
      const changes=mergeSettings({},query.changes);
      if(!query.known || typeof query.known!=='object' || Array.isArray(query.known)) throw failure('SETTINGS_SYNC_INVALID',400);
      const defaults=settingsSnapshot({});
      for(const [key,head] of Object.entries(query.known)){
        if(!defaults[key] || !head || Object.keys(head).sort().join()!=='at,id') throw failure('SETTINGS_SYNC_INVALID',400);
        mergeSettings({},{[key]:{...head,value:defaults[key].value}});
      }
      const writing=Object.keys(changes).length>0;
      const rows=await context.serial(async()=>{
        check(writing?'account:manage':'sessions:read');
        const before=settingsSnapshot(context.accountState(ownerId));
        const next=mergeSettings(before,changes);
        if (JSON.stringify(before)!==JSON.stringify(next))
          await context.mutate(ownerId,account=>savePersonalizationRows(account,next));
        return next;
      });
      if (writing && (!rows.nextSuggestionsEnabled.value || !rows.inlineCompletionEnabled.value))
        await context.nextSuggestions.drain(ownerId);
      check(writing?'account:manage':'sessions:read');
      return {box:await codec.seal('settings-response',{requestId:query.requestId,heads:settingsHeads(rows),
        rows:Object.fromEntries(Object.entries(rows).filter(([key,row])=>query.known[key]?.at!==row.at || query.known[key]?.id!==row.id))})};
    });
  };
}
