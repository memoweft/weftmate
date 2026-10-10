import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/ui-core/reply-motion.js', import.meta.url), 'utf8');
function fixture() {
  const animations: any[] = [], listeners = new Map<string, Function>(), mediaListeners = new Map<string, Function>();
  class Text {
    nodeType = 3; parentNode: any = null; data: string; constructor(data: string) { this.data = data; }
    get parentElement() { return this.parentNode; } get length() { return this.data.length; }
    get textContent() { return this.data; } set textContent(value) { this.data = value; }
    splitText(offset: number) { const tail = new Text(this.data.slice(offset)); this.data = this.data.slice(0, offset); const index = this.parentNode.childNodes.indexOf(this); this.parentNode.childNodes.splice(index + 1, 0, tail); tail.parentNode = this.parentNode; return tail; }
    replaceWith(...nodes: any[]) { const parent = this.parentNode, index = parent.childNodes.indexOf(this); parent.childNodes.splice(index, 1, ...nodes); nodes.forEach(node => node.parentNode = parent); this.parentNode = null; }
  }
  class Element {
    nodeType = 1; parentNode: any = null; childNodes: any[] = []; attributes = new Map<string, string>(); style: any = { setProperty: (key: string, value: string) => { this.style[key] = value; } }; classes = new Set<string>();
    tagName: string; constructor(tagName: string) { this.tagName = tagName.toUpperCase(); }
    classList = { add: (...names: string[]) => names.forEach(name => this.classes.add(name)), remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)), contains: (name: string) => this.classes.has(name), toggle: (name: string, force?: boolean) => { const enabled = force ?? !this.classes.has(name); enabled ? this.classes.add(name) : this.classes.delete(name); return enabled; } };
    set className(value: string) { this.classes = new Set(value.split(/\s+/)); } get className() { return [...this.classes].join(' '); }
    get isConnected() { return this === root || !!this.parentNode?.isConnected; }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); } get firstChild() { return this.childNodes[0]; }
    get parentElement() { return this.parentNode; } get textContent(): string { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value: string) { this.childNodes.forEach(node => node.parentNode = null); this.childNodes = []; if (value) this.append(new Text(value)); }
    append(...nodes: any[]) { nodes.forEach(node => { node.remove?.(); this.childNodes.push(node); node.parentNode = this; }); }
    replaceChildren(...nodes: any[]) { this.childNodes.forEach(node => node.parentNode = null); this.childNodes = []; this.append(...nodes); }
    remove() { if (!this.parentNode) return; this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
    replaceWith(...nodes: any[]) { Text.prototype.replaceWith.call(this, ...nodes); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); } getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    toggleAttribute(key: string, enabled: boolean) { enabled ? this.attributes.set(key, '') : this.attributes.delete(key); }
    matches(selector: string) { return selector.split(',').some(part => part.trim().startsWith('.') && this.classes.has(part.trim().slice(1))); }
    closest(selector: string): any { return this.matches(selector) ? this : this.parentNode?.closest?.(selector); }
    querySelectorAll(selector: string): any[] { const direct = selector.startsWith(':scope > '); const match = direct ? selector.slice(9) : selector; return this.children.flatMap(node => [...(node.matches(match) ? [node] : []), ...(direct ? [] : node.querySelectorAll(match))]); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    cloneNode() { const clone = new Element(this.tagName); clone.className = this.className; clone.attributes = new Map(this.attributes); return clone; }
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 20, width: 100, height: 20 }; }
    animate(frames: any[], timing: any) { let resolve: Function, reject: Function; const animation: any = { target: this, frames, timing, playState: 'running', finished: new Promise((done, fail) => { resolve = done; reject = fail; }), cancel() { this.playState = 'idle'; reject(new Error('cancelled')); }, finish() { this.playState = 'finished'; resolve(); }, pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; } }; animations.push(animation); return animation; }
  }
  const root = new Element('html'), body = new Element('body'); root.append(body);
  const document = { documentElement: root, body, hidden: false, createElement: (tag: string) => new Element(tag), querySelectorAll: (selector: string) => root.querySelectorAll(selector), addEventListener: (name: string, listener: Function) => listeners.set(name, listener), createTreeWalker: (element: any) => { const leaves: any[] = []; const visit = (node: any) => node.nodeType === 3 ? leaves.push(node) : node.childNodes.forEach(visit); visit(element); let index = -1; return { currentNode: null, nextNode() { this.currentNode = leaves[++index]; return !!this.currentNode; } }; }, createRange: () => ({ setStart() {}, collapse() {}, getBoundingClientRect: () => ({ left: 100, bottom: 20 }) }) };
  const media = { matches: false, addEventListener: (name: string, listener: Function) => mediaListeners.set(name, listener) };
  const storage = new Map<string, string>();
  const context: any = { document, matchMedia: () => media, localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) }, getComputedStyle: () => ({ getPropertyValue: (key: string) => ({ '--wm-duration-replyChange': '150ms', '--wm-duration-replyFragment': '120ms', '--wm-easing-desktop': 'cubic-bezier(.22,1,.36,1)' })[key] || '' }), NodeFilter: { SHOW_TEXT: 4 }, requestAnimationFrame: (fn: Function) => fn(), CustomEvent: class { type: string; constructor(type: string) { this.type = type; } }, addEventListener: (name: string, listener: Function) => listeners.set(name, listener), dispatchEvent() {} };
  vm.runInNewContext(source, context);
  const element = (text = '', tag = 'p') => { const node = new Element(tag); node.textContent = text; body.append(node); return node; };
  return { api: context.WeftReplyMotion, element, animations, root, media, document, listeners, mediaListeners };
}

test('reply status switches synchronously, coalesces rapid updates and hides visual copies from accessibility', async () => {
  const f = fixture(), status = f.element(); status.setAttribute('aria-live', 'polite');
  f.api.status(status, '正在思考…', true);
  assert.equal(status.firstChild.data, '正在思考…'); assert.equal(status.querySelector('.reply-sheen').getAttribute('aria-hidden'), 'true');
  for (let n = 0; n < 30; n++) f.api.status(status, `正在读取第 ${n + 1} 个文件…`, true);
  assert.equal(status.firstChild.data, '正在读取第 30 个文件…'); assert.equal(status.querySelectorAll('.reply-status-out').length, 1);
  assert.equal(status.querySelector('.reply-status-out').getAttribute('aria-hidden'), 'true'); assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.ok(f.animations.filter(animation => animation.playState === 'running' && animation.target.isConnected).length <= 2);
  for (const animation of f.animations) if (animation.playState === 'running') animation.finish(); await Promise.resolve();
  assert.equal(status.querySelectorAll('.reply-status-out').length, 0);
});

test('reply motion preference follows the system and explicit reduction removes animations and indicator', async () => {
  const f = fixture(), content = f.element('保留原文');
  f.api.reveal(content); f.api.indicator(content, true); assert.equal(content.querySelectorAll('.reply-indicator').length, 1);
  f.api.setPreference('reduce'); await Promise.resolve(); assert.equal(f.api.reduced, true); assert.ok(f.root.attributes.has('data-reduced-motion'));
  assert.equal(content.querySelectorAll('.reply-indicator').length, 0); assert.ok(f.animations.every(animation => animation.playState !== 'running'));
  const count = f.animations.length; f.api.reveal(content); f.api.indicator(content, true); assert.equal(f.animations.length, count); assert.equal(content.textContent, '保留原文');
  f.api.setPreference('system'); f.media.matches = true; f.mediaListeners.get('change')!(); assert.equal(f.api.reduced, true);
  f.api.setPreference('full'); assert.equal(f.api.reduced, false); assert.ok(f.root.attributes.has('data-motion-full'));
});

test('page visibility pauses active effects and resumes without replaying text or changing aria-live', () => {
  const f = fixture(), status = f.element(); f.api.status(status, '正在读取文件…', true); f.api.status(status, '正在重试…', true);
  f.document.hidden = true; f.listeners.get('visibilitychange')!(); assert.ok(f.root.attributes.has('data-motion-paused'));
  assert.ok(f.animations.filter(animation => animation.target.isConnected).every(animation => animation.playState === 'paused'));
  const count = f.animations.length; f.document.hidden = false; f.listeners.get('visibilitychange')!();
  assert.ok(!f.root.attributes.has('data-motion-paused')); assert.equal(f.animations.length, count); assert.equal(status.firstChild.data, '正在重试…');
});

test('system reply motion preference follows live native reducedMotion changes', async () => {
  const f = fixture(), content = f.element('手机原生偏好'); f.api.setPreference('system'); assert.equal(f.api.reduced, false);
  f.api.reveal(content); f.api.indicator(content, true);
  f.listeners.get('weft-motion-preference')!({ detail: { reducedMotion: true } }); await Promise.resolve();
  assert.equal(f.api.reduced, true); assert.equal(content.querySelectorAll('.reply-indicator').length, 0); assert.ok(f.root.attributes.has('data-reduced-motion'));
  f.listeners.get('weft-motion-preference')!({ detail: { reducedMotion: false } }); assert.equal(f.api.reduced, false); assert.ok(!f.root.attributes.has('data-reduced-motion'));
  f.api.setPreference('reduce'); f.listeners.get('weft-motion-preference')!({ detail: { reducedMotion: false } }); assert.equal(f.api.reduced, true);
});

test('native window visibility pauses feedback when Chromium keeps document visible', () => {
  const f = fixture(), content = f.element('窗口最小化'); f.api.reveal(content); assert.equal(f.document.hidden, false);
  f.api.setVisibility(true); assert.equal(f.api.paused, true); assert.ok(f.root.attributes.has('data-motion-paused')); assert.equal(f.animations.at(-1).playState, 'paused');
  const count = f.animations.length; f.api.reveal(content); assert.equal(f.animations.length, count);
  f.api.setVisibility(false); assert.equal(f.api.paused, false); assert.ok(!f.root.attributes.has('data-motion-paused')); assert.equal(f.animations.at(-1).playState, 'running'); assert.equal(content.textContent, '窗口最小化');
});

test('stream fragments keep text available immediately, preserve old prefix and unwrap after 120ms', async () => {
  const f = fixture(), content = f.element('已有文字 新到的短片段'); f.api.fragment(content, '已有文字 ');
  assert.equal(content.textContent, '已有文字 新到的短片段'); assert.equal(content.firstChild.data, '已有文字 ');
  assert.equal(content.querySelectorAll('.reply-fragment').length, 1); assert.equal(f.animations.at(-1).timing.duration, 120);
  f.animations.at(-1).finish(); await Promise.resolve(); assert.equal(content.querySelectorAll('.reply-fragment').length, 0); assert.equal(content.textContent, '已有文字 新到的短片段');
});

test('completion removes breathing indicator after fade without retaining reply-streaming or changing message text', async () => {
  const f = fixture(), content = f.element('回复正文'); f.api.indicator(content, true);
  const indicator = content.querySelector('.reply-indicator'); assert.equal(indicator.getAttribute('aria-hidden'), 'true'); assert.equal(content.textContent, '回复正文');
  f.api.indicator(content, false); assert.equal(content.classList.contains('reply-streaming'), false); assert.equal(content.querySelectorAll('.reply-indicator-exit').length, 1);
  f.animations.at(-1).finish(); await Promise.resolve(); assert.equal(content.querySelectorAll('.reply-indicator').length, 0); assert.equal(content.textContent, '回复正文');
});
