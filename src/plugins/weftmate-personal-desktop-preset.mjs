/** DSH keeps execution/approval native; expose all native tools directly like official DSH. */
import { PersonalDesktopBridge, registerPersonalBrowserTool, personalExecutionIdentity } from './weftmate-personal-desktop.mjs';
import { syncConnectorTools } from './personal-connectors.mjs';
import { presentPersonalPrompt, isHealthQuestion } from './personal-prompt.mjs';
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];
const PERSONAL_TOOLS = Symbol.for('weftmate.personalAssembledTools');
const assembledSys = new WeakMap();
const sessionEvents = s => typeof s?.snapshotEvents === 'function' ? s.snapshotEvents() : (s?.events ?? []);
const latestUserText = session => {
  const user = sessionEvents(session).findLast(event => event?.type === 'user/message' && event.data?.source?.kind === 'user');
  return (user?.data?.content ?? []).filter(part => part?.type === 'text').map(part => part.text).join('\n');
};
export function apply(ctx) {
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
      // namespace, before passing all real tools directly to the model.
      tools = [...tools.filter(tool => !tool.name.startsWith('mcp__c_')),
        ...ctx.tools.schemas(context.scope, context.toolSet).filter(tool => names.has(tool.name))];
    }
    context.scope[Symbol.for('weftmate.catalogTools')] = tools;
    const presented = presentPersonalPrompt({ ...assembly, tools }, new Set(tools.map(t => t.name)), {
      directTools: true,
      includeHealthGuidance: isHealthQuestion(latestUserText(context.scope.session)),
    });
    return { ...presented, [PERSONAL_TOOLS]: presented.tools };
  });
  ctx.effect(() => () => { disposeBrowser(); bridge.close(); }, 'weftmate-personal-desktop-preset: native tools');
}
export default { name, inject, apply };
