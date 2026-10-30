import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'synthetic-structured',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'read_structured',description:'Read the synthetic invoice total, returned only as structured data.',annotations:{readOnlyHint:true},
 inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{invoice:{type:'string'},total:{type:'number'}},required:['invoice','total'],additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async()=>({content:[],structuredContent:{invoice:'SYNTHETIC_INVOICE',total:137}}));
await server.connect(new StdioServerTransport());
