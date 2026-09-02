/**
 * Validation for the narrow Stage 2 OpenAI-compatible discovery contract.
 * A successful HTTP response alone is deliberately not a configured model.
 */
export function parseOpenAICompatibleModels(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new TypeError('model discovery response is invalid');
  }
  const models = [...new Set((payload as { data: unknown[] }).data.map((item) => {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') return '';
    return (item as { id: string }).id.trim();
  }).filter((id) => id.length > 0 && id.length <= 240))];
  if (models.length === 0) throw new TypeError('model discovery returned no models');
  return models;
}

/** Stage 2 verification only accepts a non-empty normal completion stop. */
export function parseVerifiedOpenAICompletion(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { choices?: unknown }).choices)) {
    throw new TypeError('model returned an invalid completion');
  }
  const choice = (payload as { choices: unknown[] }).choices[0];
  const content = choice && typeof choice === 'object' ? (choice as { message?: { content?: unknown } }).message?.content : null;
  const finishReason = choice && typeof choice === 'object' ? (choice as { finish_reason?: unknown }).finish_reason : null;
  if (typeof content !== 'string' || content.trim().length === 0 || finishReason !== 'stop') {
    throw new TypeError('model returned no verified completion');
  }
  return content;
}
