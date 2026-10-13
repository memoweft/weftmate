/** Source locations only. Tool results and conversation text never enter a review. */
export function reviewSourceLocations(events, beforeCallId) {
  const calls = new Map(), sources = new Set();
  for (const event of events) {
    if (event.type === 'tool/call') {
      if (event.data?.callId === beforeCallId) break;
      calls.set(event.data?.callId, event.data);
    }
    if (event.type !== 'tool/result') continue;
    const part = event.data?.message?.content?.find(part => part.type === 'tool-result');
    if (event.data?.error || part?.isError) continue;
    const call = calls.get(event.data?.callId ?? event.data?.message?.source?.callId ?? part?.toolCallId);
    if (!call) continue;
    if (call.name?.startsWith('mcp__')) sources.add(`connector:${call.name}`);
    let args = call.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { continue; } }
    if (!args || typeof args !== 'object') continue;
    if (/read|fetch|browse|open_page|web_search/.test(call.name)) {
      for (const key of ['file_path', 'path', 'url']) if (typeof args[key] === 'string') sources.add(args[key]);
    }
    // Shell/code reads expose locations in arguments; never inspect returned content.
    const code = [args.command, args.code, args.script].filter(value => typeof value === 'string').join('\n');
    for (const match of code.matchAll(/tools\.(?:read|web_fetch|open_page)\s*\(\s*(\{[^\n]*?\})\s*\)/g)) {
      try { const input=JSON.parse(match[1]); for (const key of ['file_path','path','url']) if (typeof input[key]==='string') sources.add(input[key]); }
      catch { /* Dynamic arguments have no statically available location. */ }
    }
    for (const match of code.matchAll(/(?:Get-Content\s+(?:(?:-LiteralPath|-Path)\s+)?|readFile(?:Sync)?\s*\(\s*|\bcat\s+)["']([^"']+)["']/g)) sources.add(match[1]);
    for (const match of code.matchAll(/(?:https?:\/\/)[^\s"'<>)}]+/g)) if (/fetch|curl|wget|Invoke-WebRequest|Invoke-RestMethod/.test(code)) sources.add(match[0]);
  }
  return [...sources];
}
