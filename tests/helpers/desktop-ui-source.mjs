/** Load exactly the production feature registrations, without a browser layout engine. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { uiCoreAssets } from '../../src/ui-core/manifest.mjs';
const root = resolve(import.meta.dirname, '../..');
const html = () => readFileSync(resolve(root, 'src/personal-access-ui/index.html'), 'utf8');
export function desktopScriptPaths() {
  return [...html().matchAll(/<script\b([^>]*)><\/script>/g)]
    .filter(match => /\bdefer\b/.test(match[1]))
    .map(match => /\bsrc="\/personal\/v1\/ui\/([^"]+)"/.exec(match[1])?.[1]).filter(Boolean);
}
export function desktopScript(path) {
  return readFileSync(resolve(root, path.startsWith('ui-core/') ? 'src' : 'src/personal-access-ui', path), 'utf8');
}
// This feature harness has no layout engine. The real Electron UI-4 suite owns modal/navigation behavior;
// model configuration still invokes the same core action here, preserving every feature assertion.
// TB-1 / TB-2 navigation is exercised by tb-1-activity.mjs / tb-2-goals.mjs in real Electron.
export function desktopFeatureSource({ modelEditor = false } = {}) {
  const navigation = desktopScript('components/settings-navigation.js');
  const editorStart = navigation.indexOf("        const form = ui.byId('account-model-form'), editor = node('dialog', 'dialog model-editor-dialog');");
  const editorEnd = navigation.indexOf("        const tools = account.querySelector('.tool-settings');", editorStart);
  if (modelEditor && (editorStart < 0 || editorEnd < 0)) throw new Error('production model editor initialization was not found');
  // Execute the production editor/lifecycle initialization while the feature
  // harness leaves navigation placement to the real Electron tests.
  const editorFactory = modelEditor ? `globalThis.WeftUiComponents.factories.testModelEditor = (core, ui) => {
    const node = (tag, className, text) => ui.element(tag, className, text);
    function mountTestModelEditor() { ${navigation.slice(editorStart, editorEnd)} }
    return { mountTestModelEditor };
  };\n` : '';
  return 'globalThis.matchMedia ||= query => ({media:query,matches:false,addEventListener(){},removeEventListener(){}});\nglobalThis.WeftUiLayout = { mountUsage() {}, mountBackup() {}, mountSchedules() {} };\n' + desktopScriptPaths().filter(path => uiCoreAssets.some(name=>path===`ui-core/${name}`) || ['ui-core/controls.js','ui-core/rendering.js','ui-core/model-label.js','ui-core/model-picker.js', ...(modelEditor ? ['ui-core/dialogs.js'] : [])].includes(path) || path.startsWith('components/') && !['components/markup.js', 'components/settings-navigation.js', 'components/settings-appearance.js', 'components/main-chat.js', 'components/activity.js', 'components/activity-view.js', 'components/goals.js', 'components/goals-view.js', 'components/health.js', 'components/health-view.js', 'components/library.js', 'components/library-view.js', 'components/search.js', 'components/search-view.js'].includes(path) || path === 'folder-choice.js' || path === 'popovers.js' || path === 'conversation-scroll.js' || path === 'cloud-ui.js' || path === 'app.js').map(path => ((path === 'app.js' ? editorFactory : '') + desktopScript(path)+(path==='popovers.js'?'\nglobalThis.WeftPopover.modelGate = () => {}; globalThis.WeftPopover.position = () => {};':'')).replace(', "mountSettingsNavigation"', modelEditor ? ', "mountTestModelEditor"' : '').replace(', "mountMainChat"', '').replace(', "mountActivity"', '').replace(', "mountGoals"', '').replace(', "mountHealth"', '').replace(', "mountLibrary"', '').replace(', "mountSearch"', '').replace(/ui\.openSettings\((['"])models\1\)/g, 'core.openAccount()')).join('\n;\n');

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


