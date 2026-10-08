/** Shared-account DSH chat has no host desktop, file, project, or memory tools. */
import { personalMemoryGuidance } from './weftmate-personal-memory.mjs';
export const name = 'weftmate-personal-shared-chat-preset';
export const inject = ['tools'];

export function apply(ctx) {
  const dispose = ctx.tools.restrict({ allow: [] });
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return { ...assembly, sections: [...assembly.sections, { name: 'weftmate:shared-decisions', text: personalMemoryGuidance }] };
  });
  ctx.effect(() => () => dispose(), 'weftmate-personal-shared-chat-preset: no host tools');
}

export default { name, inject, apply };
