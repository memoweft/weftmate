/** Native tools are contributed by the personal-remote composition. */
import { PersonalDesktopBridge, registerPersonalBrowserTool } from './weftmate-personal-desktop.mjs';
export const name = 'weftmate-personal-desktop-preset';
export const inject = ['tools'];

const descriptions = {
  pwsh: 'Run a PowerShell command in this conversation or an explicit workdir.',
  bash: 'Run a shell command in this conversation or an explicit workdir.',
  read: 'Read a file. Relative paths use this conversation directory.',
  read_image: 'Read an image file.',
  write: 'Create or replace a UTF-8 file. Read existing files before overwriting.',
  edit: 'Apply a targeted edit to a file you have read.',
  glob: 'Find files by path pattern.',
  grep: 'Search file contents.',
  web_fetch: 'Fetch and read a URL.',
  todo_write: 'Maintain the task plan and mark completed steps.',
  subagent: 'Delegate a task. Set run_in_background to false to wait for its result and files.',
};

export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeBrowser = registerPersonalBrowserTool(ctx, bridge);
  // The privileged Mod editor remains separate from personal conversations.
  const dispose = ctx.tools.restrict({ deny: ['mod_sdk'] });
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return { ...assembly, sections: [...assembly.sections, { name: 'weftmate:approval-guidance',
      text: "Respect the user's verbal instructions for this task: work independently when asked, and stop at any requested checkpoint. Use ask_user_question for requested checkpoints or missing information. Follow the current WeftMate approval-mode notice. A rejected operation is final; do not retry through another tool or command." }], tools: assembly.tools.map(tool => descriptions[tool.name]
      ? { ...tool, description: descriptions[tool.name] } : tool) };
  });
  ctx.effect(() => () => { disposeBrowser(); dispose(); bridge.close(); },
    'weftmate-personal-desktop-preset: native tools');
}
export default { name, inject, apply };
