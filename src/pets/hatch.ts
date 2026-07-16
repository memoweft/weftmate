import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { buildProceduralPet, type PetManifest } from './schema.ts';

export const LOCAL_HATCH_PROVIDER = {
  id: 'weftmate-local-hatch',
  name: 'WeftMate 本机基础孵化器',
  leavesDevice: false,
  output: 'procedural-v1',
  animated: false,
} as const;

function minimalChildEnv(): Record<string, string> {
  const names = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT'];
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
  for (const name of names) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('宠物孵化超时')), ms);
    const abort = () => reject(new Error('宠物孵化已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
  });
}

function resultText(value: unknown): string {
  const result = value as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> };
  if (result.structuredContent && typeof result.structuredContent === 'object') return JSON.stringify(result.structuredContent);
  const text = result.content?.find((item) => item?.type === 'text')?.text;
  if (!text) throw new Error('孵化器没有返回宠物设计');
  return text;
}

export async function hatchLocalPet(input: {
  profileSummary: string;
  appearanceBrief?: string;
}, signal?: AbortSignal): Promise<Omit<PetManifest, 'id' | 'schemaVersion'>> {
  if (signal?.aborted) throw new Error('宠物孵化已取消');
  if (typeof input.profileSummary !== 'string' || input.profileSummary.length > 2_000) throw new Error('画像摘要过长');
  if (typeof input.appearanceBrief === 'string' && input.appearanceBrief.length > 500) throw new Error('外观要求过长');
  const client = new Client({ name: 'weftmate-pet-host', version: '0.1.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dirname, 'hatch-mcp-server.mjs')],
    env: minimalChildEnv(),
    stderr: 'pipe',
  });
  try {
    await withTimeout(client.connect(transport), 10_000, signal);
    const result = await withTimeout(client.callTool({
      name: 'hatch_pet',
      arguments: {
        profileSummary: input.profileSummary,
        appearanceBrief: input.appearanceBrief ?? '',
      },
    }), 20_000, signal);
    const candidate = JSON.parse(resultText(result)) as Record<string, unknown>;
    const exact = ['name', 'description', 'shape', 'primary', 'accent', 'feature'];
    const actual = Object.keys(candidate).sort();
    if (actual.length !== exact.length || ![...exact].sort().every((key, index) => actual[index] === key)) {
      throw new Error('孵化器返回了不支持的字段');
    }
    const validated = buildProceduralPet({
      id: 'pet:hatch-preview',
      name: candidate.name,
      description: candidate.description,
      shape: candidate.shape,
      primary: candidate.primary,
      accent: candidate.accent,
      feature: candidate.feature,
    });
    return {
      name: validated.name,
      description: validated.description,
      appearance: validated.appearance,
    };
  } finally {
    try { await client.close(); } catch { /* 子进程已退出 */ }
    try { await transport.close(); } catch { /* client.close 已完成同一收尾 */ }
  }
}
