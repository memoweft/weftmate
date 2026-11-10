// The origin, cloud account, data key and publishing host identify a single feed.
const invalid = () => Object.assign(new Error('DIRECTORY_INVALID'), { code: 'DIRECTORY_INVALID' });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const startCursor = () => ({ removed: 0, changed: 0 });
const number = n => Number.isSafeInteger(n) && n >= 0;
export const validCursor = c => !!c && number(c.removed) && number(c.changed);
export const equalCursor = (a,b) => validCursor(a) && validCursor(b) && a.removed === b.removed && a.changed === b.changed;
export function directoryCodec(vendor, key, scope) {
  return accountDataCodec(vendor,key,scope,'wm-chat-directory+jwe');
}
export function accountDataCodec(vendor,key,scope,typ) {
  const header = {alg:'dir', enc:'A256GCM', typ, kid:scope[2]};
  return {
    async seal(purpose, value) {
      const bytes = new TextEncoder().encode(JSON.stringify([scope,purpose,value]));
      try { return await new vendor.CompactEncrypt(bytes).setProtectedHeader(header).encrypt(key); }
      finally { bytes.fill(0); }
    },
    async open(purpose, box) {
      try {
        const {plaintext, protectedHeader} = await vendor.compactDecrypt(box, key,
          {keyManagementAlgorithms:['dir'], contentEncryptionAlgorithms:['A256GCM']});
        try {
          const [origin, kind, value] = JSON.parse(new TextDecoder().decode(plaintext));
          if (protectedHeader.typ !== header.typ || protectedHeader.kid !== header.kid || !same(origin,scope) || kind !== purpose) throw invalid();
          return value;
        } finally { plaintext.fill(0); }
      } catch { throw invalid(); }
    },
  };
}

const lanes = [['removed',true], ['changed',false]];
export function directoryPage(feed, cursor, limit = 64) {
  if (!validCursor(cursor) || Math.max(cursor.removed,cursor.changed) > feed.seq) throw invalid();
  const next = {...cursor}, rows = [];
  let more = false;
  for (const [lane,deleted] of lanes) {
    const pending = feed.rows.filter(r => !!r.deleted === deleted && r.seq > cursor[lane]).sort((a,b) => a.seq-b.seq);
    const batch = pending.slice(0,limit-rows.length);
    rows.push(...batch);
    if (batch.length === pending.length) next[lane] = feed.seq;
    else {
      if (batch.length) next[lane] = batch.at(-1).seq;
      more = true;
    }
  }
  return {epoch:feed.epoch, from:cursor, next, rows, more};
}

export function applyDirectoryPage(cache, page, requestId) {
  const from = cache?.cursor ?? startCursor();
  if (page?.requestId !== requestId || !equalCursor(from,page.from) || !validCursor(page.next) ||
      !page.epoch || cache && page.epoch !== cache.epoch || !Array.isArray(page.rows) || page.rows.length > 64 ||
      typeof page.label !== 'string' || typeof page.more !== 'boolean' ||
      page.next.removed < from.removed || page.next.changed < from.changed ||
      page.more && equalCursor(from,page.next)) throw invalid();
  const rows = new Map((cache?.rows ?? []).map(row => [row.id,row]));
  for (const row of page.rows) {
    const lane = row?.deleted === true ? 'removed' : 'changed';
    if (typeof row?.id !== 'string' || !number(row.seq) || row.seq <= from[lane] || row.seq > page.next[lane]) throw invalid();
    const prior = rows.get(row.id);
    if (prior && (prior.seq >= row.seq || prior.deleted)) continue;
    if (row.deleted === true) rows.set(row.id,{id:row.id,seq:row.seq,deleted:true});
    else {
      if (typeof row.title !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw invalid();
      rows.set(row.id,{id:row.id,seq:row.seq,title:row.title,updatedAt:row.updatedAt,contentRevision:row.contentRevision??1});
    }
  }
  return {epoch:page.epoch,cursor:page.next,label:page.label,rows:[...rows.values()]};
}
