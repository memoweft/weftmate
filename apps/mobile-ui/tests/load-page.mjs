/* Fake-DOM tests load the same shared functionality and components as the page. */
import { readFileSync } from 'node:fs';
const www = new URL('../www/', import.meta.url);
export const mobileHtml = readFileSync(new URL('index.html', www), 'utf8') + readFileSync(new URL('layout.js', www), 'utf8');
export const mobileSource = "globalThis.WeftIcons={create:()=>document.createElement('svg')};\n" + [...readFileSync(new URL('index.html', www), 'utf8').matchAll(/<script defer src="([^"]+)"/g)]
  .map(match => match[1]).filter(name => name.startsWith('ui-core/') || name === 'conversation-scroll.js' || name === 'popovers.js' || name === 'timeline.js' || name === 'app.js' || name.startsWith('components/'))
  // This functional fixture has no computed styles or animation engine. Reply
  // presentation is exercised by reply-motion.test.ts and real three-surface tests.
  .filter(name => name !== 'ui-core/reply-motion.js')
  // Dropdown geometry and native option DOM belong to the real-browser semantic suites.
  .map(name => readFileSync(new URL(name, www), 'utf8') + (name === 'popovers.js' ? '\nglobalThis.WeftPopover.bindSettingsSelect = () => {}; globalThis.WeftPopover.modelGate = () => {};' : '')).join('\n');
