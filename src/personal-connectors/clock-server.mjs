import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'weftmate-local-clock', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'read_local_time', description: '只读：读取本机时间，不联网。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'read_local_time') throw new Error('Unknown tool');
  return { content: [{ type: 'text', text: JSON.stringify({ time: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }] };
});
await server.connect(new StdioServerTransport());
