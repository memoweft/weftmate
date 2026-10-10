/* Exact callback registration in the isolated running cloud avoids a fixture restart. */
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
registerHooks({load(url,context,next){if(!url.endsWith('/services/cloud/src/main.mjs'))return next(url,context);return {format:'module',shortCircuit:true,source:readFileSync(new URL(url),'utf8').replace('  const config = loadConfig();','  const config = loadConfig(); globalThis.__m31Config=config;').replace('  relay = identity.relay;','  globalThis.__m31Identity=identity; relay = identity.relay;')};}});
await import('../../../../services/cloud/src/main.mjs');
const lines=createInterface({input:process.stdin});
lines.on('line',async line=>{const body=JSON.parse(line);if(!/^https:\/\/h-[a-f0-9]{32}\.hosts\.example\.com\/personal\/v1\/ui\/$/.test(body.redirect))throw Error('Invalid isolated callback');const client=await globalThis.__m31Identity.provider.Client.find('weftmate-web');client.redirectUris=[...new Set([...client.redirectUris,body.redirect])];const config=globalThis.__m31Config.clients.find(c=>c.client_id==='weftmate-web');config.redirect_uris=[...new Set([...config.redirect_uris,body.redirect])];console.log(JSON.stringify({event:'m31.callback.registered'}));});
