import './fact-1-baseline-preload.mjs';
import './baseline-request-trace.mjs';
import { appendFileSync } from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (typeof options?.body === 'string') {
    try {
      const body = JSON.parse(options.body);
      if (body.messages) {
        const text = JSON.stringify(body.messages);
        appendFileSync(process.env.WEFTMATE_BASELINE_TRACE, JSON.stringify({kind:'fact-policy',at:new Date().toISOString(),
          on:text.includes('Research self-check is ON'),off:text.includes('Research self-check is OFF'),
          grounded:text.includes('Research writing must be checkable')})+'\n');
      }
    } catch { /* Only JSON model requests are inspected; no prompt text is recorded. */ }
  }
  return original(input, options);
};
