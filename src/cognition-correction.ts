import { createHash } from 'node:crypto';

/** 同一条推断、同一份正确内容始终得到同一幂等键；原文不进入 originId。 */
export function cognitionCorrectionOriginId(cognitionId: string, correctedContent: string): string {
  const id = cognitionId.trim();
  const content = correctedContent.trim();
  if (!id || !content) throw new Error('指正幂等键缺少条目或正确内容');
  const digest = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24);
  return `weftmate-cognition-correction:${id}:${digest}`;
}
