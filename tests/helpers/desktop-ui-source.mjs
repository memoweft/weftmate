/** Load exactly the production feature registrations, without a browser layout engine. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const html = () => readFileSync(resolve(root, 'src/personal-access-ui/index.html'), 'utf8');
export function desktopScriptPaths() {
  return [...html().matchAll(/<script src="\/personal\/v1\/ui\/([^"]+)" defer><\/script>/g)].map(match => match[1]);
}
export function desktopScript(path) {
  return readFileSync(resolve(root, path.startsWith('ui-core/') ? 'src' : 'src/personal-access-ui', path), 'utf8');
}
// This feature harness has no layout engine. The real Electron UI-4 suite owns modal/navigation behavior;
// model configuration still invokes the same core action here, preserving every feature assertion.
// TB-1 / TB-2 navigation is exercised by tb-1-activity.mjs / tb-2-goals.mjs in real Electron.
export function desktopFeatureSource() {
  return 'globalThis.WeftUiLayout = { mountUsage() {}, mountBackup() {}, mountSchedules() {} };\n' + desktopScriptPaths().filter(path => path.startsWith('ui-core/') || path.startsWith('components/') && !['components/markup.js', 'components/settings-navigation.js', 'components/main-chat.js', 'components/activity.js', 'components/activity-view.js', 'components/goals.js', 'components/goals-view.js'].includes(path) || path === 'conversation-scroll.js' || path === 'cloud-ui.js' || path === 'app.js').map(path => desktopScript(path).replace(', "mountSettingsNavigation"', '').replace(', "mountMainChat"', '').replace(', "mountActivity"', '').replace(', "mountGoals"', '').replace('ui.openSettings("models")', 'core.openAccount()')).join('\n;\n');
}
export function desktopHtml() {
  const context = { document: { body: { innerHTML: '' } } };
  runInNewContext(desktopScript('components/markup.js') + '\n;\n' + desktopScript('layout.js'), context);
  return html().replace(/<body>\s*<\/body>/, `<body>${context.document.body.innerHTML}</body>`);
}


