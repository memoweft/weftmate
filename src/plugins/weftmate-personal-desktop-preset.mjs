/** DSH keeps execution/approval native; only model presentation is deferred. */
import { PersonalDesktopBridge, registerPersonalBrowserTool } from './weftmate-personal-desktop.mjs';
import { presentPersonalPrompt } from './personal-prompt.mjs';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];
const LOAD = 'load_tools';
export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeBrowser = registerPersonalBrowserTool(ctx, bridge);
  const dispose = ctx.tools.restrict({ deny: ['mod_sdk'] });
  const loaded = new WeakMap();
  const schemas = new WeakMap();
  ctx.tools.register(defineTool({ name: LOAD,
    description: 'Load tools by their exact catalog names before calling them. Tools remain available with native permissions and approvals.',
    parameters: { names: { type: 'array', items: { type: 'string' }, required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      const catalog = schemas.get(exec.agent) ?? [];
      const selected = loaded.get(exec.agent) ?? new Set();
      const missing = args.names.filter(name => !catalog.some(tool => tool.name === name));
      if (missing.length) return { error: 'Unknown tool names', missing };
      for (const name of args.names) selected.add(name);
      loaded.set(exec.agent, selected);
      exec.agent[Symbol.for('weftmate.loadedTools')] = selected;
      return { loaded: args.names };
    },
    presentCall: () => ({ card: 'generic', title: '加载所需工具', kind: 'read' }),
  }));
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next();
    if (!context.scope || !['personal-remote'].includes(context.scope.session?.header?.agentPreset)) return assembly;
    schemas.set(context.scope, assembly.tools);
    return presentPersonalPrompt(assembly, loaded.get(context.scope));
  });
  ctx.effect(() => () => { disposeBrowser(); dispose(); bridge.close(); }, 'weftmate-personal-desktop-preset: native tools');
}
export default { name, inject, apply };
