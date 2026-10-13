import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fixtureServer } from './server.mjs';
import { appendFileSync } from 'node:fs';
if (process.env.ST7A_STARTS) appendFileSync(process.env.ST7A_STARTS, `${process.pid}\n`);
if (process.env.ST7A_CRASH_LOOP === '1') setTimeout(() => process.exit(7), 300);
await fixtureServer().connect(new StdioServerTransport());
