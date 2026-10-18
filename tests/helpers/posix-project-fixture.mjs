// Linux CI has no Windows directory picker. These narrowly scoped fixtures
// use the shipped POSIX inspector (real handles/inode identity), as a folder
// selection substitute. Production platform support and native approvals stay unchanged.
import { registerHooks } from 'node:module';
const targets = ['personal-tool-approvals.test.ts', 'personal-approval-mode-execution.test.ts', 'personal-forget-loop.test.ts', 'work-and-chat-runtime.test.ts', 'work-and-chat-controls.test.ts', 'w4-first-work-switch.test.ts', 'relay-phone.test.mjs'];
if (process.platform === 'linux' && process.argv.some(arg => targets.some(name => arg.endsWith(name)))) {
  const urls = new Set([new URL('../../src/personal-projects/index.mjs', import.meta.url).href,
    new URL('../../src/personal-access/store.mjs', import.meta.url).href]);
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!urls.has(url)) return result;
    const source = String(result.source).replaceAll("process.platform === 'darwin'", "['darwin', 'linux'].includes(process.platform)")
      .replace("!['win32', 'darwin'].includes(process.platform)", "!['win32', 'darwin', 'linux'].includes(process.platform)");
    return { ...result, source };
  } });
}
