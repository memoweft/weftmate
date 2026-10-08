// Test-only scheduling seam: hold the first claimed input until native cancellation.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

registerHooks({ load(url, context, nextLoad) {
  if (url.includes('/dsh-agent-loop/lib/index.js')) {
    const source = readFileSync(new URL(url), 'utf8');
    const seam = 'const claimed = this.inbox.claim(target, position.turn);';
    assert.ok(source.includes(seam), 'Pinned native claim seam must exist');
    return { format: 'module', shortCircuit: true, source: source.replace(seam, `${seam}
      if (position.turn === 1 && claimed.some(message => message.content?.some(part => part.text === 'synthetic blocking task'))) {
        console.log('[early-stop] claimed before persistence');
        await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
        signal.throwIfAborted();
      }`) };
  }
  return nextLoad(url, context);
} });
