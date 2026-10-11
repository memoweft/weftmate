import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireHeavySlot } from '../scripts/nightly/heavy-slot.mjs';

test('heavy operations release their slot after failure and preserve other owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weftmate-heavy-test-'));
  try {
    await writeFile(join(root,'heavy-1.lock'),'other package');
    const slot = await acquireHeavySlot(root,'fixture');
    assert.equal(slot.index,2);
    try { throw Error('synthetic stage failure'); } catch {} finally { await slot.release(); }
    assert.equal(await readFile(join(root,'heavy-1.lock'),'utf8'),'other package');
    await assert.rejects(readFile(join(root,'heavy-2.lock')));
    await slot.release();
    const next = await acquireHeavySlot(root,'next stage'); assert.equal(next.index,2); await next.release();
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('heavy slots wait when all three are held, and reclaim only an abandoned slot', async () => {
  const root = await mkdtemp(join(tmpdir(),'weftmate-heavy-test-'));
  try {
    for (let i=1;i<=3;i++) await writeFile(join(root,`heavy-${i}.lock`),'other package');
    let cancelled=false;
    await assert.rejects(acquireHeavySlot(root,'fixture',{retryMs:1,cancelled:()=>cancelled,onWait:()=>{cancelled=true;}}),/已停止/);
    const old=new Date(Date.now()-46*60000); await utimes(join(root,'heavy-3.lock'),old,old);
    const messages:string[]=[];
    const slot=await acquireHeavySlot(root,'fixture',{onWait:(text:string)=>messages.push(text)});
    assert.equal(slot.index,3); assert.equal(messages.length,1); await slot.release();
    for(let i=1;i<=2;i++) assert.equal(await readFile(join(root,`heavy-${i}.lock`),'utf8'),'other package');
  } finally { await rm(root,{recursive:true,force:true}); }
});
