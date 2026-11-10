// 保护：重复和并发读取不重复解压；文件改变或核验失败不能沿用旧结论，恢复仍须重新验全量。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,lstat,utimes,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createBackupCatalog} from '../src/personal-backup/catalog.mjs';
import {verify} from '../src/personal-backup/archive.mjs';
import {createBackupManager} from '../src/personal-backup/index.mjs';
import {managedMkdtemp,disposeManagedTemp} from './helpers/managed-temp.mjs';

const now=Date.parse('2026-11-09T12:00:00Z');
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return{promise,release};};
async function fixture(t:any){const base=await managedMkdtemp('backup-catalog-'),directory=join(base,'Backups'),root=join(base,'profile');await mkdir(directory);await mkdir(root);t.after(()=>disposeManagedTemp(base));return{base,directory,root};}
async function archive(file:string,createdAt=now,text='synthetic'){
 const bytes=Buffer.from(text),manifest={format:'weftmate-local-backup',version:1,createdAt:new Date(createdAt).toISOString(),reason:'manual',files:[{path:'personal-access/store.json',size:bytes.length,sha256:digest(bytes)}]};
 const header=JSON.stringify(manifest);await writeFile(file,gzipSync(Buffer.concat([Buffer.from(`WMB1 ${digest(header)}\n${header}\n`),bytes])));
}
async function until(fn:()=>boolean){for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error('condition not reached');}

test('concurrent inventory requests share one full verification and unchanged files reuse it',async t=>{
 const f=await fixture(t),file=join(f.directory,'one.wmb');await archive(file);const wait=gate();let reads=0;
 const catalog=createBackupCatalog({verifyFile:async file=>{reads++;await wait.promise;return verify(file);}});
 const first=catalog.list(f.directory),second=catalog.list(f.directory);await until(()=>reads===1);wait.release();const [a,b]=await Promise.all([first,second]);await catalog.list(f.directory);
 assert.equal(reads,1);assert.deepEqual(a,b);assert.equal(a[0].verification,'valid');
});

test('a same-size modification with restored mtime cannot reuse a successful verification',async t=>{
 const f=await fixture(t),file=join(f.directory,'changed.wmb');await archive(file);let reads=0;const catalog=createBackupCatalog({verifyFile:file=>{reads++;return verify(file);}});
 await catalog.list(f.directory);const old=await lstat(file),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);await utimes(file,old.atime,old.mtime);
 assert.equal((await catalog.list(f.directory))[0].verification,'invalid');assert.equal(reads,2);
});

test('changing a file during verification discards the old result and rechecks the new file',async t=>{
 const f=await fixture(t),file=join(f.directory,'race.wmb');await archive(file);const wait=gate();let reads=0;
 const catalog=createBackupCatalog({verifyFile:async file=>{const result=await verify(file);if(++reads===1)await wait.promise;return result;}});
 const first=catalog.list(f.directory);await until(()=>reads===1);await archive(file,now,'new synthetic contents');wait.release();
 assert.equal((await first)[0].verification,'invalid');assert.equal((await catalog.list(f.directory))[0].verification,'valid');assert.equal(reads,2);
});

test('a failed read is retried even when file metadata does not change',async t=>{
 const f=await fixture(t),file=join(f.directory,'retry.wmb');await archive(file);let reads=0;
 const catalog=createBackupCatalog({verifyFile:async file=>{if(++reads===1)throw Error('temporary read failure');return verify(file);}});
 assert.equal((await catalog.list(f.directory))[0].verification,'invalid');assert.equal((await catalog.list(f.directory))[0].verification,'valid');assert.equal(reads,2);
});

test('daily lookup stops at a verified current-day copy while full inventory still reads older copies',async t=>{
 const f=await fixture(t),files=['old.wmb','new.wmb'];await archive(join(f.directory,files[0]),now-86400000);await archive(join(f.directory,files[1]),now);
 await utimes(join(f.directory,files[0]),new Date(now-86400000),new Date(now-86400000));await utimes(join(f.directory,files[1]),new Date(now),new Date(now));const reads:string[]=[];
 const catalog=createBackupCatalog({verifyFile:file=>{reads.push(basename(file));return verify(file);}});
 const today=await catalog.list(f.directory,{until:row=>row.verification==='valid'&&row.createdAt.startsWith('2026-11-09')});assert.deepEqual(reads,['new.wmb']);assert.equal(today.length,1);
 assert.equal((await catalog.list(f.directory)).length,2);
});

test('overlapping daily ticks coalesce before checking whether the host is idle',async t=>{
 const f=await fixture(t);await archive(join(f.directory,'today.wmb'));const wait=gate();let idleChecks=0;
 const manager=await createBackupManager({root:f.root,clock:()=>now,isIdle:async()=>{idleChecks++;await wait.promise;return true;},requestRestart:()=>assert.fail('unexpected restart')});
 const first=manager.checkDaily(),second=manager.checkDaily();assert.equal(idleChecks,1);wait.release();await Promise.all([first,second]);await manager.stopOnline();
 assert.equal((await readdir(f.directory)).length,1);
});

test('restore revalidates every byte even after the inventory cached a valid backup',async t=>{
 const f=await fixture(t),file=join(f.directory,'restore.wmb');await archive(file);let restarts=0;
 const manager=await createBackupManager({root:f.root,clock:()=>now,isIdle:async()=>true,requestRestart:()=>{restarts++;}});await manager.view();
 const bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);
 await assert.rejects(manager.restore('restore.wmb'),{code:'BACKUP_CORRUPT'});assert.equal(restarts,0);await manager.stopOnline();
});
