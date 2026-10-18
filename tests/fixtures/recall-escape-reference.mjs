// Independent producer reference for PR B's Python renderer. Entry separators
// are LF; body line endings and whitespace are content, not normalization.
export function renderRecallReference(items) {
  return items.map(item => {
    const body = item.body.split('\n').map(line =>
      ['Memory:', 'Memory (past):', '记忆：', '记忆（过往）：', '\\'].some(prefix => line.startsWith(prefix))
        ? `\\${line}` : line).join('\n');
    return `${item.past ? 'Memory (past):' : 'Memory:'}${body}`;
  }).join('\n');
}
