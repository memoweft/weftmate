import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';

export const TEST_ACCESS_KEY_ID = 'synthetic-access-key';
export const TEST_ACCESS_KEY_SECRET = 'synthetic-access-secret';
// Separate verifier reconstructs from the *received* HTTP request; it does not
// call the production signer. TXT values and credentials here are synthetic.
export function verifyAliyunRequest(req) {
  const authorization = /^ACS3-HMAC-SHA256 Credential=([^,]+),SignedHeaders=([^,]+),Signature=([a-f0-9]{64})$/.exec(req.headers.authorization);
  assert.ok(authorization); assert.equal(authorization[1], TEST_ACCESS_KEY_ID);
  const names = authorization[2].split(';');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['x-acs-version'], '2015-01-09');
  assert.ok(Math.abs(Date.now() - Date.parse(req.headers['x-acs-date'])) < 60_000);
  assert.ok(req.headers['x-acs-signature-nonce']);
  const hash = text => createHash('sha256').update(text).digest('hex');
  assert.equal(req.headers['x-acs-content-sha256'], hash(''));
  const url = new URL(req.url, 'http://localhost');
  const canonical = `${req.method}\n${url.pathname}\n${url.search.slice(1)}\n` +
    names.map(key => `${key}:${req.headers[key].trim()}\n`).join('') + `\n${names.join(';')}\n${hash('')}`;
  assert.equal(authorization[3], createHmac('sha256', TEST_ACCESS_KEY_SECRET).update(`ACS3-HMAC-SHA256\n${hash(canonical)}`).digest('hex'));
  return { action: req.headers['x-acs-action'], parameters: Object.fromEntries(url.searchParams) };
}
export async function fakeAliyun(t, { onUpdate = async () => {} } = {}) {
  const records = new Map([['foreign', { name: '_acme-challenge.other.hosts.example.com', value: 'foreign-txt' }]]);
  const calls = []; let nextId = 1, failure = null;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    try {
      const call = verifyAliyunRequest(req); calls.push(call);
      const body = []; for await (const chunk of req) body.push(chunk);
      assert.equal(Buffer.concat(body).length, 0);
      if (failure) { res.writeHead(403); res.end(JSON.stringify({ Code: failure, Message: TEST_ACCESS_KEY_SECRET })); return; }
      const p = call.parameters;
      if (call.action === 'AddDomainRecord') {
        assert.equal(p.DomainName, 'example.com'); assert.equal(p.Type, 'TXT'); assert.equal(p.TTL, '600');
        assert.deepEqual(Object.keys(p).sort(), ['DomainName','RR','TTL','Type','Value']);
        const RecordId = String(nextId++); records.set(RecordId, { name: `${p.RR}.${p.DomainName}`, value: p.Value });
        await onUpdate(records, records.get(RecordId).name);
        res.end(JSON.stringify({ RecordId }));
      } else if (call.action === 'DeleteDomainRecord') {
        assert.deepEqual(Object.keys(p), ['RecordId']); assert.notEqual(p.RecordId, 'foreign');
        const entry = records.get(p.RecordId);
        if (!entry) { res.writeHead(400); res.end(JSON.stringify({ Code: 'InvalidRecordId.NotFound' })); return; }
        records.delete(p.RecordId); await onUpdate(records, entry.name);
        res.end(JSON.stringify({ RecordId: p.RecordId }));
      } else throw new Error('Unexpected AliDNS action');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ Code: 'FAKE_API_ASSERTION_FAILED', Message: error.message })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { endpoint: `http://127.0.0.1:${server.address().port}/`, records, calls, fail: code => { failure = code; } };
}
