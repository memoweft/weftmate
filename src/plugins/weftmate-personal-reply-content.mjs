import { cleanReplyStream, modelToolFailure } from './personal-reply-content.mjs';

export const name = 'weftmate-personal-reply-content';
export const inject = ['llm', 'sessions', 'tools'];
const failureCodes = result => [...new Set(JSON.stringify([result.error, result.content]).match(/\b(?:MEMORY|TOOL)_[A-Z0-9_]+\b/g) ?? [])].join(',') || 'TOOL_FAILED';
const personal = session => ['personal-remote','personal-shared-chat'].includes(session?.header?.agentPreset);

export async function apply(ctx) {
  const { isAgentLoopRequest } = await import('@deepseek-ai/dsh-llm');
  ctx.on('llm/stream', (options, next) => isAgentLoopRequest(options) && personal(ctx.sessions.get(options.sessionId))
    ? cleanReplyStream(next(), options) : next(), { global:true });
  // Code Mode throws error.message into user programs, so sanitize that channel too.
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next();
    if (!personal(exec.agent?.session)) return result;
    const content = modelToolFailure(exec.name, result);
    if (!content) return result;
    ctx.logger?.warn?.(`tool failure code=${failureCodes(result)}`);
    return result.isError ? {...result,content,error:{...result.error,message:content[0].text}}
      : {...result,value:{message:content[0].text}};
  }, { prepend:true });
  // Nested Code Mode calls also receive plain errors before their parent can quote them.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (!personal(exec.agent?.session)) return decision;
    const content = modelToolFailure(exec.name, decision.kind === 'block'
      ? {isError:true,content:decision.feedback} : {...result,content:decision.content ?? result.content});
    if (content) ctx.logger?.warn?.(`tool failure code=${failureCodes(result)}`);
    return content ? decision.kind === 'block' ? {...decision,feedback:content} : {...decision,content} : decision;
  }, { prepend:true });
  ctx.on('session/created', session => {
    if (!personal(session)) return;
    const calls = new Map(session.events.filter(event => event.type === 'tool/call').map(event => [event.data.callId,event.data.name]));
    const append = session.append.bind(session);
    session.append = (type, data, ...rest) => {
      if (type === 'tool/call') calls.set(data.callId,data.name);
      if (type === 'tool/result') {
        const tool = calls.get(data.message.source?.callId);
        const content = data.message.content.map(part => {
          if (part.type !== 'tool-result') return part;
          const replacement = modelToolFailure(tool,part);
          if (replacement) ctx.logger?.warn?.(`tool failure code=${failureCodes(part)}`);
          return replacement ? {...part,content:replacement} : part;
        });
        // The error field stays in the local event log; only message.content feeds the next model step.
        data = {...data,message:{...data.message,content}};
      }
      return append(type,data,...rest);
    };
  });
}
export default {name,inject,apply};
