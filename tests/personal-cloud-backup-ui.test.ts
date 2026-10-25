import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { desktopScript } from './helpers/desktop-ui-source.mjs';

class Element {
  tagName; className = ''; children = []; parentNode = null; dataset = {}; attributes = new Map(); listeners = new Map();
  hidden = false; disabled = false; value = ''; checked = false; open = false; content = '';
  constructor(tag, className = '', text = '') { this.tagName = tag.toUpperCase(); this.className = className; this.content = text; }
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.content = String(value); this.replaceChildren(); }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]); }
  fire(name) { return Promise.all((this.listeners.get(name) ?? []).map(callback => callback({ target: this, currentTarget: this, preventDefault() {} }))); }
  click() { return this.fire('click'); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire('close'); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.className.split(/\s+/).includes(selector.slice(1))
      : selector.startsWith('[aria-label=') ? node.getAttribute('aria-label') === selector.slice(13, -2)
        : selector === '*' || node.tagName === selector.toUpperCase();
    return this.children.flatMap(child => [...matches(child) ? [child] : [], ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cloudBackup = { id: 'synthetic-cloud-backup-a', createdAt: '2026-10-13T08:00:00.000Z', totalBytes: 1234567 };
const listing = () => ({ available: true, enabled: false, restoreSuggested: true, keyAvailable: true, items: [cloudBackup],
  usage: { usedBytes: cloudBackup.totalBytes, reservedBytes: 0, limitBytes: 300 * 1024 * 1024 } });

function harness() {
  const body = new Element('body'), calls = [], intervals = [];
  let payload = listing(), readOverride = null, mounted;
  const core = {
    state: { account: { ownerId: 'synthetic-owner-a' }, device: { id: 'synthetic-desktop-a' }, csrfToken: 'synthetic-csrf-a', identityGeneration: 1, accountViewGeneration: 0, currentView: 'assistant' },
    accountToken() { return { generation: this.state.identityGeneration, view: this.state.accountViewGeneration,
      ownerId: this.state.account?.ownerId, deviceId: this.state.device?.id, csrf: this.state.csrfToken }; },
    accountCurrent(token) { return this.state.currentView === 'account' && token.view === this.state.accountViewGeneration && this.accountIdentityCurrent(token); },
    dateText: () => '10 月 13 日',
    async accessApi(path, options = {}) {
      calls.push({ path, options });
      if (path === '/backups/cloud') return readOverride ? readOverride() : structuredClone(payload);
      if (path === '/backups/cloud/dismiss') { payload.restoreSuggested = false; return { dismissed: true }; }
      if (path === '/backups') return { settings: { enabled: true, directory: 'synthetic-backup-directory', dailyDays: 7, weeklyCopies: 4 }, backups: [], status: null };
      throw new Error(`unexpected synthetic route ${path}`);
    },
  };
  const ui = { element: (tag, className = '', text = '') => new Element(tag, className, text), toast() {} };
  const context = { document: { body, createElement: tag => new Element(tag) }, WeftUiComponents: { factories: {} }, WeftUiCore: { factories: {} }, weftmateDesktop: {},
    WeftSettingsControls: { toggle() {} }, WeftIcons: { create: () => new Element('svg') },
    WeftUiLayout: { mountBackup: section => { mounted = section; body.append(section); } },
    setInterval: callback => { intervals.push(callback); return intervals.length; }, setTimeout() {},
  };
  runInNewContext([desktopScript('ui-core/controls.js'), desktopScript('ui-core/auth.js'), desktopScript('ui-core/backup.js'), desktopScript('components/backup.js')].join('\n;\n'), context);
  Object.assign(core, context.WeftUiCore.factories.auth(core, {}, {}));
  Object.assign(core, context.WeftUiCore.factories.backup(core));
  const component = context.WeftUiComponents.factories.backup(core, ui); component.mountBackup();
  const prompt = body.querySelector('.cloud-backup-prompt'); assert.ok(prompt);
  return { core, component, body, prompt, calls, mounted, intervals, setPayload: value => { payload = value; }, setRead: reader => { readOverride = reader; } };
}

test('S4 the assistant discovers a cloud backup using account identity, and dismissing the hint leaves settings restore available', async () => {
  const f = harness(), token = f.core.accountToken();
  assert.equal(f.core.accountCurrent(token), false); assert.equal(f.core.accountIdentityCurrent(token), true);
  await f.component.checkCloudBackupPrompt(); assert.equal(f.prompt.hidden, false); assert.match(f.prompt.textContent, /发现这个账号的云端备份.*10 月 13 日.*要恢复吗/);
  const later = f.prompt.querySelectorAll('button').find(button => button.textContent === '稍后'); assert.ok(later); await later.click(); await flush();
  assert.equal(f.prompt.hidden, true);
  const dismissed = f.calls.find(call => call.path === '/backups/cloud/dismiss'); assert.ok(dismissed); assert.equal(dismissed.options.body.id, cloudBackup.id);
  await f.component.checkCloudBackupPrompt(); assert.equal(f.prompt.hidden, true);
  f.core.state.currentView = 'account'; f.core.state.accountViewGeneration++;
  f.component.showSettingsBackups(); await flush();
  const region = f.mounted.querySelector('.cloud-backup-settings'), restore = region.querySelectorAll('button').find(button => button.textContent === '恢复');
  assert.ok(restore, 'dismissing the hint does not remove the selectable backup from settings'); await restore.click();
  const dialog = f.body.querySelectorAll('dialog').find(node => node.getAttribute('aria-label') === '恢复云端备份'); assert.ok(dialog?.open);
  assert.ok(dialog.querySelectorAll('input').some(node => node.getAttribute('aria-label') === '恢复码'));
  assert.match(f.core.cloudBackupErrorText({ code: 'CLOUD_BACKUP_RECOVERY_CODE', invalidGroups: [2, 4] }), /第 2、4 组抄写不对/);
  assert.match(f.core.cloudBackupErrorText({ code: 'CLOUD_BACKUP_RECOVERY_CODE', details: { invalidGroups: [7] } }), /第 7 组抄写不对/);
  assert.equal(f.core.cloudBackupErrorText({code:'RUNTIME_UNAVAILABLE'}),'这次备份没成功，请稍后重试。');
});

test('S4 an unavailable old-cloud capability produces no discovery hint and settings explains temporary unavailability', async () => {
  const f = harness(); f.setPayload({ available: false, reason: 'CLOUD_BACKUP_UNAVAILABLE' });
  await f.component.checkCloudBackupPrompt(); assert.equal(f.prompt.hidden, true); assert.equal(f.prompt.children.length, 0);
  f.core.state.currentView = 'account'; f.core.state.accountViewGeneration++;
  f.component.showSettingsBackups(); await flush();
  const region = f.mounted.querySelector('.cloud-backup-settings'); assert.match(region.textContent, /暂不可用/);
  assert.equal(region.querySelectorAll('button').length, 0);
  assert.ok(f.calls.every(call => ['/backups', '/backups/cloud'].includes(call.path)), 'the unavailable state does not attempt any cloud-backup action');
});

test('S4 account changes, leaving the assistant and logout immediately hide discovery, and an old response cannot reopen it', async () => {
  for (const transition of ['switch-account', 'leave-assistant', 'logout']) {
    const f = harness(); await f.component.checkCloudBackupPrompt(); assert.equal(f.prompt.hidden, false);
    const pending = deferred(); f.setRead(() => pending.promise); const oldCheck = f.component.checkCloudBackupPrompt();
    if (transition === 'switch-account') { f.core.state.account = { ownerId: 'synthetic-owner-b' }; f.core.state.identityGeneration++; }
    else if (transition === 'leave-assistant') { f.core.state.currentView = 'account'; f.core.state.accountViewGeneration++; }
    else { f.core.state.account = null; f.core.state.device = null; f.core.state.csrfToken = null; f.core.state.identityGeneration++; }
    const hiddenCheck = f.component.checkCloudBackupPrompt(); assert.equal(f.prompt.hidden, true, `${transition} hides the hint before any response arrives`); await hiddenCheck;
    pending.resolve(listing()); await oldCheck;
    assert.equal(f.prompt.hidden, true, `${transition} discards the old account/view response`);
  }
});
