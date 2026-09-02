/** Minimal DOM seam: appending a new message must preserve existing nodes. */
export function appendMessageNode(root, message, createNode) {
  const node = createNode(message);
  root.append(node);
  return node;
}

export function updateMessageNode(root, id, text) {
  const escape = globalThis.CSS?.escape ?? ((value) => String(value).replace(/["\\]/g, '\\$&'));
  const node = root.querySelector(`[data-message-id="${escape(id)}"]`);
  if (node) node.textContent = text;
  return node;
}
