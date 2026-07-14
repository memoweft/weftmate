import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_AGENT_WORKSPACE_NAME = 'WeftMate';

/**
 * 为 Agent 创建用户可见、范围收窄的默认工作区。
 * documentsDir 由 Electron app.getPath('documents') 提供；调用者不应传 userData。
 */
export function ensureDefaultAgentWorkspace(documentsDir: string): string {
  const documents = resolve(String(documentsDir || '').trim());
  const workspace = join(documents, DEFAULT_AGENT_WORKSPACE_NAME);
  mkdirSync(workspace, { recursive: true });
  if (!statSync(workspace).isDirectory()) throw new Error('默认工作区不是文件夹');
  return workspace;
}
