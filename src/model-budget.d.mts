export interface ModelCapacity { contextWindow: number; maxTokens: number }
export interface ModelCapacityInput {
  baseUrl: string; modelId: string; contextWindow?: number; maxTokens?: number; apiKey?: string;
}
export const DEFAULT_MODEL_CAPACITY: Readonly<ModelCapacity>;
export function knownModelCapacity(input: ModelCapacityInput): ModelCapacity | undefined;
export function modelCapacityFor(input: ModelCapacityInput): ModelCapacity;
export function readModelCapacity(input: ModelCapacityInput, options?: {
  fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<ModelCapacity & { source: 'metadata' | 'props' | 'models' | 'config' | 'default' }>;
export function outputBudget(input: {
  contextWindow: number; inputTokens: number; maxTokens?: number; safetyTokens?: number;
}): number;
