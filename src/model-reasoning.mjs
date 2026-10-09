/** Provider wire declarations for the existing DSH reasoning selector. No request defaults. */
export function modelReasoning(profile) {
  let host; try { host = new URL(profile.baseUrl).hostname; } catch { return null; }
  const id = profile.model ?? profile.modelId ?? '';
  const levels = { off: null, low: 'low', medium: 'medium', high: 'high' };
  if (host === 'api.xiaomimimo.com' && /^mimo-v2\.[56]/i.test(id))
    return { reasoningEfforts: levels, compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: false } };
  if (host === 'api.deepseek.com' && /reasoner|deepseek-v4/i.test(id))
    return { reasoningEfforts: levels, compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: false } };
  if (host === 'dashscope.aliyuncs.com' && /^qwen3/i.test(id) && !/instruct/i.test(id))
    return { reasoningEfforts: levels, compat: { thinkingFormat: 'qwen', supportsReasoningEffort: false } };
  if (host === 'api.openai.com' && /^(o[134](?:-|$)|gpt-[56])/i.test(id) ||
      ['low', 'medium', 'high'].includes(profile.reasoningEffort))
    return { reasoningEfforts: levels, compat: { thinkingFormat: 'openai', supportsReasoningEffort: true } };
  return null;
}

export const reasoningCapability = profile => ({ supported: !!modelReasoning(profile),
  ...(modelReasoning(profile) ? { effort: 'high' } : {}) });

/** Upgrade a previously registered owned route's absent capability declarations in place. */
export async function prepareOfficialModelReasoning(client, route, profile) {
  const declared = modelReasoning(profile);
  const snapshot = await client.describeSettings();
  const actual = snapshot.userProviders[route] ?? snapshot.baseProviders[route];
  const model = actual?.models?.find(row => row.id === profile.model);
  if (!model) return false;
  // Existing native declarations are authoritative, including an explicit unsupported model.
  if (model.reasoningEfforts !== undefined) return model.reasoningEfforts !== false && !!model.reasoningEfforts.high;
  if (!declared) return false;
  const value = {...actual,models:actual.models.map(row=>row!==model?row:{...row,...declared,
    compat:{...declared.compat,...row.compat}})};
  await client.mutateSettings([{op:'set',path:['providers',route],value}],snapshot.revision);
  return true;
}
