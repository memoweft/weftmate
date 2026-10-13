import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { fixtureServer } from './server.mjs';
import { fileURLToPath } from 'node:url';
export async function httpFixture({ token = 'synthetic-http-credential', outputFile = process.env.ST7A_OUTPUT } = {}) {
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== token) { response.writeHead(401); response.end(); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const instance = fixtureServer({outputFile}); await instance.connect(transport);
    response.on('close', () => { void transport.close(); void instance.close(); });
    await transport.handleRequest(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await httpFixture(); process.send?.({ url: fixture.url });
  process.on('disconnect', () => process.exit(0));
}
