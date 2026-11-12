import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import {join, relative} from 'node:path';
export const sha = value => createHash('sha256').update(value).digest('hex');
export async function retained(root) {
  const native = {},base=join(root,'dsh-home/sessions');
  async function walk(dir) {
    for(const x of await readdir(dir,{withFileTypes:true})){
      const file=join(dir,x.name);
      if(x.isDirectory())await walk(file);
      else if(x.isFile()&&/^session\.jsonl(?:\.zstd)?$/.test(x.name))native[sha(relative(base,file))]=sha(await readFile(file));
    }
  }
  await walk(base);
  const accounts=Object.values(JSON.parse(await readFile(join(root,'personal-access/store.json'))).accounts);
  const identity=JSON.parse(await readFile(join(root,'personal-access/cloud-identity/identity.json')));
  const trust=Object.entries(identity.devices).map(([id,d])=>[id,d.ownerId,d.cloudDeviceId,d.jkt,d.status]).sort();
  return { personalization:sha(JSON.stringify(accounts.map(a=>[a.personalization,a.personalizationUpdatedAt,a.personalizationChanges]))), native,devices:accounts.reduce((n,a)=>n+Object.keys(a.devices).length,0),
    deviceIdentities:sha(JSON.stringify(accounts.map(a=>Object.keys(a.devices).sort()))),
    trust:sha(JSON.stringify(trust)),vault:sha(await readFile(join(root,'weftmate-model.enc'))),
    modelChoice:sha(JSON.stringify(accounts.map(a=>[a.defaultModelProfileId,a.lastChatModelProfileId]))),
    desktopSettings:sha(JSON.stringify(JSON.parse(await readFile(join(root,'weftmate-settings.json'))).models)) };
}
import assert from 'node:assert/strict';
import {zstdDecompressSync} from 'node:zlib';
export async function verifyRetained(root,expected,lengths){
 const now=await retained(root);for(const key of Object.keys(expected))if(key!=='native')assert.deepEqual(now[key],expected[key],key);
 const files=new Map(),base=join(root,'dsh-home/sessions');async function paths(dir){for(const e of await readdir(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory())await paths(f);else if(e.isFile())files.set(sha(relative(base,f)),f);}}await paths(base);
 const appended=[];
 for(const [id,beforeHash] of Object.entries(expected.native)){
  assert.ok(files.has(id),'existing transcript missing');if(now.native[id]===beforeHash)continue;
  const n=lengths[id],bytes=await readFile(files.get(id));assert.ok(n>0&&bytes.length>n&&sha(bytes.subarray(0,n))===beforeHash,'existing transcript must be an exact byte-for-byte prefix');
  const suffix=bytes.subarray(n),magic=Buffer.from('28b52ffd','hex'),offsets=[];let p=0;
  while((p=suffix.indexOf(magic,p))>=0){offsets.push(p);p+=4;}assert.equal(offsets[0],0);
  const events=offsets.flatMap((start,i)=>zstdDecompressSync(suffix.subarray(start,offsets[i+1]??suffix.length)).toString().trim().split('\n').filter(Boolean).map(line=>{const r=JSON.parse(line);return (r.event??r).type;}));
  assert.ok(events.length&&events.every(t=>t==='session/end-seed'),'append contains more than a native session-end marker');
  appended.push({id,types:events});
 }
 return {originalFiles:Object.keys(expected.native).length,appended};
}
