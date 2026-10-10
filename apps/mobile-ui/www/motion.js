/* Presentation only: settle layout now, animate visual continuity independently. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set(), owners = new WeakMap();
  let nativeReduced = globalThis.weftReducedMotion === true;
  const reduced = () => globalThis.WeftReplyMotion?.reduced ?? (preference.matches || nativeReduced);
  const css = () => getComputedStyle(document.documentElement);
  function milliseconds(name) {
    const value = css().getPropertyValue(`--wm-duration-${name}`).trim();
    return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  }
  function play(element, frames, name = 'fast', index = 0, cleanup) {
    if (!element) { cleanup?.(); return; }
    owners.get(element)?.cancel();
    if (reduced() || (globalThis.WeftReplyMotion?.paused ?? document.hidden) || !element.isConnected || !element.animate) { cleanup?.(); return; }
    const animation = element.animate(frames, { duration: milliseconds(name),
      easing: css().getPropertyValue('--wm-easing-desktop').trim(), fill: 'backwards',
      delay: Math.min(index * milliseconds('stagger'), milliseconds('staggerLimit')) });
    owners.set(element, animation); active.add(animation);
    const done = () => { active.delete(animation); if (owners.get(element) === animation) owners.delete(element); cleanup?.(); };
    animation.finished.then(done, done);
    return animation;
  }
  function reveal(element, name = 'fast', index = 0) {
    return play(element, [{ opacity: .65 }, { opacity: 1 }], name, index);
  }
  function push(element, back = false, name = 'base') {
    const distance = css().getPropertyValue('--wm-space-16').trim();
    return play(element, [{ opacity: .8, transform: `translateX(${back ? '-' : ''}${distance})` },
      { opacity: 1, transform: 'translateX(0)' }], name);
  }
  function snapshot(element) {
    if (reduced() || !element?.isConnected || element.hidden) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return;
    const copy = element.cloneNode(true);
    copy.removeAttribute('id'); for (const child of copy.querySelectorAll('[id]')) child.removeAttribute('id');
    if(copy.classList.contains('conversation-approval')) { copy.classList.remove('conversation-approval'); copy.classList.add('motion-approval'); }
    copy.inert = true; copy.setAttribute('aria-hidden', 'true'); copy.classList.add('motion-copy');
    Object.assign(copy.style, { position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', transform: 'none' });
    document.body.append(copy); return copy;
  }
  function dismiss(copy, crop = false, slide = false) {
    if (!copy) return;
    const distance = css().getPropertyValue('--wm-space-16').trim();
    play(copy, [{ opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'translateX(0)' },
      { opacity: 0, clipPath: crop ? 'inset(0 0 100% 0)' : 'inset(0 0 0 0)',
        transform: slide === 'drawer' ? 'translateX(-100%)' : slide ? `translateX(${distance})` : 'translateX(0)' }], 'exit', 0, () => copy.remove());
  }
  function hide(element, slide = false) { const copy = snapshot(element); element.hidden = true; dismiss(copy, false, slide); }
  function changed(element, key, name = 'fast') {
    if (!element || element.dataset.motionKey === key) return;
    element.dataset.motionKey = key; reveal(element, name);
  }
  function details(element) {
    const summary = element.querySelector('summary');
    summary?.addEventListener('click', event => {
      if (event.defaultPrevented || event.target.closest('button, a, input')) return;
      event.preventDefault();
      const steps = [...element.querySelectorAll('.execution-step')], short = steps.length <= 20;
      const copy = element.open && short ? snapshot(element) : null;
      element.open = !element.open;
      if (element.open && short) { reveal(element, 'base'); steps.forEach((step, index) => reveal(step, 'fast', index)); }
      else dismiss(copy, true);
    });
  }
  function syncPreference() {
    document.documentElement.toggleAttribute('data-reduced-motion', reduced());
    if (reduced()) {
      for (const animation of [...active]) animation.cancel();
      document.querySelectorAll('.motion-copy').forEach(copy => copy.remove());
    }
  }
  preference.addEventListener('change', syncPreference);
  addEventListener('weft-motion-preference', event => {
    nativeReduced = event.detail?.reducedMotion === true; syncPreference();
  });
  addEventListener('weft-reply-motion-change', () => { syncPreference(); if(!reduced())for(const animation of active) {if((globalThis.WeftReplyMotion?.paused ?? document.hidden))animation.pause();else animation.play();} });
  syncPreference();
  globalThis.WeftMobileMotion = { play, reveal, push, snapshot, dismiss, hide, changed, details, reduced, milliseconds };
})();
