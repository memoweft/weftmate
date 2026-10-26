// Controlled chat timing only; this fixture never forms or returns computer memory.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

export async function createPhoneWindowModelFixture() {
  const starts = [], releases = new Map();
  let completed = 0, aborted = 0, nonStreamRequests = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/report') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ starts, completed, aborted, nonStreamRequests })); return;
      }
      if (url.pathname === '/release' && req.method === 'POST') {
        const release = releases.get(url.searchParams.get('marker'));
        res.writeHead(release ? 200 : 404); release?.(); res.end(); return;
      }
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
      if (req.headers.authorization !== 'Bearer synthetic-state-key') { res.writeHead(401); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      if (!body.stream) {
        nonStreamRequests++; res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '合成连接检查' } }] })); return;
      }
      const marker = body.messages.filter(row => row.role === 'user').at(-1)?.content;
      if (typeof marker !== 'string') { res.writeHead(400); res.end(); return; }
      starts.push(marker);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const delta = content => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
      let finished = false;
      res.once('close', () => { if (!finished) aborted++; releases.get(marker)?.(); });
      delta('Started:' + marker);
      if (marker.startsWith('WINDOW-SLOW:')) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 90000);
          releases.set(marker, () => { clearTimeout(timer); releases.delete(marker); resolve(); });
        });
      }
      if (!res.destroyed) { delta('|Done:' + marker); completed++; finished = true; res.end('data: [DONE]\n\n'); }
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() { for (const release of [...releases.values()]) release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createPhoneWindowModelFixture();
  console.log(JSON.stringify({ origin: fixture.origin }));
  process.once('SIGTERM', async () => { await fixture.close(); process.exit(); });
}
