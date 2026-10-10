/** Owned disposable host process. Killing/restarting it tests a real listener/process outage. */
import {androidSyntheticBackend} from './and-2-fixture.mjs';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
const [root,issuer,port]=process.argv.slice(2);
const host=await createPersonalAccessService({root,port:Number(port),backend:androidSyntheticBackend(root),cloudIdentity:{issuer,allowInsecureLoopback:true,clientId:'weftmate-android'}});
process.send(await host.start());
process.on('message',async({method})=>{const result=await host[method]();process.send(result??{});});
