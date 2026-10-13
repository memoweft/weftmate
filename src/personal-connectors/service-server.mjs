import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { connectorError } from './policy.mjs';
const config = JSON.parse(process.env.WEFTMATE_CONNECTOR_CONFIG);
config.password = process.env.AUTH_CODE;
if (config.kind === 'ics') config.url = process.env.ICS_URL;
delete process.env.AUTH_CODE; delete process.env.ICS_URL; delete process.env.WEFTMATE_CONNECTOR_CONFIG;
const kind = process.env.WEFTMATE_CONNECTOR_KIND;
// Dependencies must never activate credential-bearing debug logs inherited
// from a development shell. Only this managed service's environment changes.
delete process.env.DEBUG;
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const module = await import(kind === 'mail' ? './mail.mjs' : './calendar.mjs');
const service = kind === 'mail' ? module.createMail(config) : module.createCalendar(config);
let ready;
const connect = () => ready ??= service.test();
const server = new Server({ name: `weftmate-${kind}`, version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try { await connect(); return { tools: service.tools }; }
  catch (error) { const safe = connectorError(error); throw new McpError(ErrorCode.InternalError, `${safe.code}: ${safe.message}`); }
});
server.setRequestHandler(CallToolRequestSchema, async request => {
  try { await connect(); const result = await service.call(request.params.name, request.params.arguments ?? {}); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
  catch (error) { const safe = /^(MAIL|CALENDAR)_/.test(error?.code ?? '') ? error : connectorError(error); return { isError: true, content: [{type:'text',text:safe.message}] }; }
});
await server.connect(new StdioServerTransport());
process.once('SIGTERM', async () => { await service.close(); process.exit(0); });
