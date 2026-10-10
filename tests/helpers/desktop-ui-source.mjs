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
  return 'globalThis.WeftUiLayout = { mountUsage() {}, mountBackup() {}, mountSchedules() {} };\n' + desktopScriptPaths().filter(path => path.startsWith('ui-core/') || path.startsWith('components/') && !['components/markup.js', 'components/settings-navigation.js', 'components/main-chat.js', 'components/activity.js', 'components/activity-view.js', 'components/goals.js', 'components/goals-view.js', 'components/library.js', 'components/library-view.js'].includes(path) || path === 'folder-choice.js' || path === 'popovers.js' || path === 'conversation-scroll.js' || path === 'cloud-ui.js' || path === 'app.js').map(path => (desktopScript(path)+(path==='popovers.js'?'\nglobalThis.WeftPopover.modelGate = () => {}; globalThis.WeftPopover.position = () => {};':'')).replace(', "mountSettingsNavigation"', '').replace(', "mountMainChat"', '').replace(', "mountActivity"', '').replace(', "mountGoals"', '').replace(', "mountLibrary"', '').replace('ui.openSettings("models")', 'core.openAccount()')).join('\n;\n');

}
export function desktopHtml() {
  const context = { document: { body: { innerHTML: '' } } };
  runInNewContext(desktopScript('components/markup.js') + '\n;\n' + desktopScript('layout.js'), context);
  return html().replace(/<body>\s*<\/body>/, `<body>${context.document.body.innerHTML}</body>`);
}

/** Give fake DOMs the production parents; assertions remain based on names/roles. */
export function mountDesktopTestTree(document, get) {
  const parents = [document.body];
  for (const match of desktopHtml().matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match;
    if (match[0].startsWith('</')) {
      const index = parents.findLastIndex(node => node.tagName === tag.toUpperCase());
      if (index > 0) parents.length = index;
      continue;
    }
    const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
    const node = id ? get(id) : document.createElement(tag);
    node.tagName = tag.toUpperCase(); node.root = false;
    for (const attribute of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    parents.at(-1).append(node);
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag)) parents.push(node);
  }
}


