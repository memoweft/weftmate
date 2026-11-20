/** DSH keeps execution/approval native; only model presentation is deferred. */
import { PersonalDesktopBridge, registerPersonalBrowserTool, personalExecutionIdentity } from './weftmate-personal-desktop.mjs';
import { syncConnectorTools } from './personal-connectors.mjs';
import { presentPersonalPrompt } from './personal-prompt.mjs';
import { installToolLoadingRecovery } from './personal-tool-loading.mjs';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];
const LOAD = 'load_tools';
const PERSONAL_TOOLS = Symbol.for('weftmate.personalAssembledTools');
const assembledSys = new WeakMap();
export function apply(ctx) {
  installToolLoadingRecovery(ctx);
  const sys = ctx.get?.('systemPrompt');
  if (sys && typeof sys.assemble === 'function') {
    const entry = assembledSys.get(sys) ?? (() => {
      const orig = sys.assemble;
      const state = { count: 0, restore: () => { if (sys.assemble !== orig) sys.assemble = orig; assembledSys.delete(sys); } };
      sys.assemble = async function (context = {}) {
        const result = await orig.call(this, context);
        if (!result?.[PERSONAL_TOOLS]) return result;
        const tools = result[PERSONAL_TOOLS];
        const next = { ...result, tools };
        delete next[PERSONAL_TOOLS];
        return next;
      };
      assembledSys.set(sys, state);
      return state;
    })();
    entry.count++;
    ctx.effect(() => () => { if (--entry.count <= 0) entry.restore(); }, 'weftmate-personal-desktop-preset: systemPrompt tools');
  }
  const bridge = new PersonalDesktopBridge();
  const disposeBrowser = registerPersonalBrowserTool(ctx, bridge);
  const loaded = new WeakMap();
  const schemas = new WeakMap();
  ctx.tools.register(defineTool({ name: LOAD,
    description: 'Load exact catalog names, e.g. {"names":["write"]}. Native permissions and approvals apply.',
    parameters: { names: { type: 'array', items: { type: 'string' }, required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      const catalog = schemas.get(exec.agent) ?? [];
      const selected = loaded.get(exec.agent) ?? new Set();
      const missing = args.names.filter(name => !catalog.some(tool => tool.name === name));
      if (missing.length || !args.names.length) throw new Error('Choose nonempty exact tool names from the current catalog.');
      for (const name of args.names) selected.add(name);
      loaded.set(exec.agent, selected);
      exec.agent[Symbol.for('weftmate.loadedTools')] = selected;
      return { loaded: args.names };
    },
    presentCall: () => ({ card: 'generic', title: '加载所需工具', kind: 'read' }),
  }));
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    let assembly = await next();
    if (!context.scope || !['personal-remote'].includes(context.scope.session?.header?.agentPreset)) return assembly;
    let tools = Array.isArray(assembly.tools) ? assembly.tools : ctx.tools.schemas(context.scope, context.toolSet);
    if (context.scope.session.header.origin !== 'subagent') {
      const policy = await bridge.request({ action: 'approval_policy', sessionId: context.scope.session.id,
        turn: 0, callId: 'approval-policy', messageHash: '0'.repeat(64) });
      syncConnectorTools(context.scope, policy, bridge, personalExecutionIdentity);
      const names = new Set((policy.connectorTools ?? []).map(tool => tool.name));
      // DSH collects tool providers before this waterfall. Refresh only our
      // namespace, before the native loader captures its catalog and projects it.
      tools = [...tools.filter(tool => !tool.name.startsWith('mcp__c_')),
        ...ctx.tools.schemas(context.scope, context.toolSet).filter(tool => names.has(tool.name))];
    }
    schemas.set(context.scope, tools);
    context.scope[Symbol.for('weftmate.catalogTools')] = tools;
    const presented = presentPersonalPrompt({ ...assembly, tools }, loaded.get(context.scope));
    return { ...presented, [PERSONAL_TOOLS]: presented.tools };
  });
  ctx.effect(() => () => { disposeBrowser(); bridge.close(); }, 'weftmate-personal-desktop-preset: native tools');
}
export default { name, inject, apply };
