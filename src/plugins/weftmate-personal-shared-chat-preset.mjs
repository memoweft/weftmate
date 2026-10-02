/** Shared-account DSH chat has no host desktop, file, project, or memory tools. */
export const name = 'weftmate-personal-shared-chat-preset';
export const inject = ['tools'];

export function apply(ctx) {
  const dispose = ctx.tools.restrict({ allow: [] });
  ctx.effect(() => () => dispose(), 'weftmate-personal-shared-chat-preset: no host tools');
}

export default { name, inject, apply };
