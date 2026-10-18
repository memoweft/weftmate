// Only ciphertext crosses the temporary mapped folder; plaintext stays in processes.
import {readFile,writeFile} from 'node:fs/promises';
import {publicEncrypt,constants} from 'node:crypto';
import {join} from 'node:path';
const directory=process.argv[2];
if(!directory||!process.env.B1_MODEL_KEY)throw Error('Explicit output directory and process-only B1_MODEL_KEY required');
const packet=Buffer.from(JSON.stringify({modelKey:process.env.B1_MODEL_KEY,email:process.env.B1_TEST_EMAIL||''}));
const ciphertext=publicEncrypt({key:await readFile(join(directory,'guest-public.pem')),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},packet);
await writeFile(join(directory,'key-envelope.bin'),ciphertext,{flag:'wx'});packet.fill(0);
