// Account-key encrypted per-source replica. Each durable transition compares the previous ciphertext.
const validKey = key => typeof key==='string' && /^(cognition|entity|relationship|event):[A-Za-z0-9._:-]{1,512}$/.test(key);
export function openMemoryReplica({codec,read,write,current,exchange,deviceId,random}) {
  const empty = () => ({revision:-1,items:[],pending:[],forgotten:[]});
  async function load() {
    const box = await read();
    const cache = box === undefined ? empty() : await codec.open('memory-cache',box);
    current();
    return {box,cache};
  }
  async function save(previous,next) {
    next={...next,tick:(next.tick??0)+1};
    const box = await codec.seal('memory-cache',next);
    current();
    await write(previous,box);
    return {box,cache:next};
  }
  async function ask(op,fields={}) {
    const requestId=random();
    const box=await codec.seal('memory-request',{op,deviceId,requestId,...fields});
    current();
    const response=await exchange({box});
    const reply=await codec.open('memory-response',response.box);
    current();
    if (reply?.requestId!==requestId || reply.op!==op || !reply.result) throw Error('MEMORY_SYNC_INVALID');
    return reply.result;
  }
  const hidden = cache => new Set([...cache.forgotten,...cache.pending.flatMap(intent=>intent.keys)]);
  return {
    async read() { return (await load()).cache; },
    async review(intentId) {
      const {cache}=await load(), intent=cache.pending.find(x=>x.intentId===intentId && x.review);
      if (!intent) throw Error('MEMORY_SCOPE_REVIEW');
      const manifest=await ask('manifest');
      if (manifest.revision<cache.revision) throw Error('MEMORY_SYNC_INVALID');
      const page=await ask('items',{revision:manifest.revision,keys:[intent.key]});
      const [item]=page.items;
      if (item?.key!==intent.key || !item.plan?.scope || page.revision!==manifest.revision) throw Error('MEMORY_SCOPE_REVIEW');
      return item;
    },
    async forget(key,confirmed,reviewed) {
      const {box,cache}=await load();
      const prior=reviewed && cache.pending.find(x=>x.review && x.key===key && x.intentId===reviewed.intentId);
      if (reviewed && !prior) throw Error('MEMORY_SCOPE_REVIEW');
      const item=prior ? reviewed.item : cache.items.find(x=>x.key===key);
      if (!item || item.key!==key || !item.plan?.scope || item.plan.scope!==confirmed.scope || item.plan.impact!==confirmed.impact) throw Error('MEMORY_SCOPE_REVIEW');
      const intent={key,scope:confirmed.scope,impact:confirmed.impact,keys:item.plan.keys,intentId:random()};
      const pending=[...cache.pending.filter(x=>x!==prior),intent], mask=new Set(intent.keys);
      const next={...cache,pending,items:cache.items.filter(row=>!mask.has(row.key))};
      return (await save(box,next)).cache;
    },
    async sync(show=()=>{}) {
      let {box,cache}=await load();
      const commit=async next=>{ ({box,cache}=await save(box,next));current();show(cache); };
      // Check receipts before downloading changes, including after a lost response.
      for (const intent of [...cache.pending]) {
        if (intent.review) continue;
        try {
          const result=await ask('forget',{key:intent.key,scope:intent.scope,impact:intent.impact,intentId:intent.intentId});
          if (!['applied','already-removed'].includes(result.state)) throw Error('MEMORY_SYNC_INVALID');
          const removed=result.state==='applied' ? intent.keys : [intent.key];
          await commit({...cache,forgotten:[...new Set([...cache.forgotten,...removed])],
            pending:cache.pending.filter(x=>x.intentId!==intent.intentId)});
        } catch (error) {
          // An unfinished command must not delay tombstones confirmed elsewhere.
          if (['MEMORY_FORMATION_PENDING','MEMORY_REVISION_CHANGED','MEMORY_FORGET_INCOMPLETE','MEMORY_DELETE_UNAVAILABLE','MEMORY_UNAVAILABLE'].includes(error.code)) continue;
          if (error.code!=='MEMORY_SCOPE_REVIEW') throw error;
          await commit({...cache,pending:cache.pending.map(x=>x.intentId===intent.intentId?{...x,review:true}:x)});
        }
      }
      const manifest=await ask('manifest');
      if (!Number.isSafeInteger(manifest.revision) || manifest.revision<cache.revision ||
          !Array.isArray(manifest.index) || !Array.isArray(manifest.retired)) throw Error('MEMORY_SYNC_INVALID');
      if (manifest.index.some(row=>!validKey(row?.key) || typeof row.stamp!=='string' || !/^[\w-]{43}$/.test(row.stamp)) ||
          !manifest.retired.every(validKey)) throw Error('MEMORY_SYNC_INVALID');
      const index=new Map(manifest.index.map(row=>[row.key,row.stamp]));
      if (index.size!==manifest.index.length) throw Error('MEMORY_SYNC_INVALID');
      const forgotten=[...new Set([...cache.forgotten,...manifest.retired])];
      const pending=cache.pending.filter(intent=>!(intent.review && manifest.retired.includes(intent.key)));
      const mask=hidden({forgotten,pending});
      const kept=cache.items.filter(row=>index.has(row.key) && !mask.has(row.key));
      if (kept.length!==cache.items.length || forgotten.length!==cache.forgotten.length ||
          pending.length!==cache.pending.length || manifest.revision!==cache.revision)
        await commit({...cache,revision:manifest.revision,items:kept,pending,forgotten});
      const known=new Set(kept.filter(row=>index.get(row.key)===row.stamp).map(row=>row.key));
      const missing=[...index.keys()].filter(key=>!known.has(key)&&!mask.has(key));
      for (let i=0;i<missing.length;i+=16) {
        const keys=missing.slice(i,i+16),page=await ask('items',{revision:manifest.revision,keys});
        if (page.revision!==manifest.revision || !Array.isArray(page.items) || page.items.length!==keys.length ||
            page.items.some((row,n)=>row.key!==keys[n] || row.stamp!==index.get(row.key) || typeof row.text!=='string' ||
              !Array.isArray(row.plan?.keys) || !row.plan.keys.includes(row.key))) throw Error('MEMORY_SYNC_INVALID');
        await commit({...cache,items:[...cache.items.filter(row=>!keys.includes(row.key)),...page.items]});
      }
      current();
      return (await load()).cache;
    },
  };
}
