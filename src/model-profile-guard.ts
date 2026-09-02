/**
 * Persistent-session protection for Stage 2 profile changes.  The caller reads
 * its `referenced` fact from the schema-validated on-disk session binding, not
 * from a renderer/sidebar cache, so a cold start is protected before any UI
 * session list is opened.
 */
export function assertModelProfileMutationAllowed(input: {
  referenced: boolean;
  operation: 'edit' | 'delete';
  displayNameOnly?: boolean;
}): void {
  if (!input.referenced) return;
  if (input.operation === 'edit' && input.displayNameOnly === true) return;
  if (input.operation === 'delete') throw new Error('此模型仍被历史会话引用，不能删除其凭据。请保留该配置或新增替代模型。');
  throw new Error('此模型已被历史会话引用。只能修改名称；请新增配置并切换，历史会话不会被改写。');
}
