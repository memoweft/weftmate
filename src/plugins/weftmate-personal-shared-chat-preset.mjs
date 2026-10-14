/** Shared-account DSH chat exposes only the owner's memory operations. */
import { personalMemoryGuidance, personalMemoryToolsGuidance } from './weftmate-personal-memory.mjs';
export const name = 'weftmate-personal-shared-chat-preset';
export const inject = ['tools'];

export function apply(ctx) {
  // DSH restricts inherited global tools; account memory is registered locally
  // on the agent and remains visible without granting any host capabilities.
  const dispose = ctx.tools.restrict({ allow: [] });
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return { ...assembly, sections: [...assembly.sections, { name: 'weftmate:shared-decisions', text: personalMemoryGuidance + ' ' + personalMemoryToolsGuidance }] };
  });
  ctx.effect(() => () => dispose(), 'weftmate-personal-shared-chat-preset: no host tools');
}

export default { name, inject, apply };
