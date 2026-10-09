// Cross-language vector generator: production Windows/Android wire envelope, no stored private key.
import { sealReplica } from '../../../src/personal-offline/crypto.mjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
const {payload,jwk,identity}=JSON.parse(text);
process.stdout.write(JSON.stringify(sealReplica(payload,jwk,identity)));
