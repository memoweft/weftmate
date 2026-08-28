import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const palettes = [
  ['#c46f8b', '#f1b3c5'],
  ['#6d8fd1', '#b8d5ff'],
  ['#6da47a', '#b8d98d'],
  ['#b98550', '#f1c27d'],
  ['#8c73bf', '#d4c2ff'],
  ['#4f9b9b', '#a9e3df'],
];
const shapes = ['orbit', 'sprout', 'wisp'];
const features = ['thread', 'leaf', 'halo', 'ears'];
const names = ['小织', '小芽', '微澜', '团团', '点点', '小栖', '阿绒', '星点'];

function numberAt(hash, offset) {
  return Number.parseInt(hash.slice(offset, offset + 8), 16);
}

const server = new McpServer({ name: 'weftmate-local-pet-hatch', version: '0.1.0' });

server.registerTool('hatch_pet', {
  title: '孵化本机基础宠物',
  description: '根据用户明确确认的简短画像摘要，在本机生成一个原创程序化宠物设计；不访问网络、文件、模型、密钥或其它记忆。',
  inputSchema: {
    profileSummary: z.string().max(2_000),
    appearanceBrief: z.string().max(500).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ profileSummary, appearanceBrief = '' }) => {
  const seed = `${profileSummary.trim()}\n${appearanceBrief.trim()}`;
  const hash = createHash('sha256').update(seed || 'weftmate-new-friend').digest('hex');
  const palette = palettes[numberAt(hash, 0) % palettes.length];
  const shape = shapes[numberAt(hash, 8) % shapes.length];
  const feature = features[numberAt(hash, 16) % features.length];
  const requested = appearanceBrief.match(/(?:叫|名(?:字)?(?:是|叫)?|named?)\s*[「“"']?([^，。,.；;「」“”"']{1,12})/iu)?.[1]?.trim();
  const name = requested || names[numberAt(hash, 24) % names.length];
  const result = {
    name,
    description: appearanceBrief.trim()
      ? `根据你确认的线索和「${appearanceBrief.trim().slice(0, 80)}」在本机孵化。`
      : '根据你确认的线索在本机孵化，外观不会携带那些线索。',
    shape,
    primary: palette[0],
    accent: palette[1],
    feature,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
});

await server.connect(new StdioServerTransport());
