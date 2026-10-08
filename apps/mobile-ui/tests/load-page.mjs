/* Fake-DOM tests load the same shared functionality and components as the page. */
import { readFileSync } from 'node:fs';
const www = new URL('../www/', import.meta.url);
export const mobileHtml = readFileSync(new URL('index.html', www), 'utf8') + readFileSync(new URL('layout.js', www), 'utf8');
export const mobileSource = [...readFileSync(new URL('index.html', www), 'utf8').matchAll(/<script defer src="([^"]+)"/g)]
  .map(match => match[1]).filter(name => name.startsWith('ui-core/') || name === 'popovers.js' || name === 'timeline.js' || name === 'app.js' || name.startsWith('components/'))
  .map(name => readFileSync(new URL(name, www), 'utf8')).join('\n');
