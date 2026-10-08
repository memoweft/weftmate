/* Desktop presentation only. Layout and feature actions always settle synchronously. */
(() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set(), owners = new WeakMap();
  const listLimit = 20;
  function timing(name = 'fast', delayIndex = 0) {
    const css = getComputedStyle(document.documentElement);
    const milliseconds = key => {
      const value = css.getPropertyValue(`--wm-duration-${key}`).trim();
      return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    };
    return { fill: 'backwards', duration: milliseconds(name), easing: css.getPropertyValue('--wm-easing-desktop').trim(),
      delay: Math.min(delayIndex * milliseconds('stagger'), milliseconds('staggerLimit')) };
  }
  function cancel(element) { owners.get(element)?.cancel(); }
  function play(element, frames, name = 'fast', index = 0, cleanup) {
    cancel(element);
    if (preference.matches || !element?.isConnected || !element.animate) { cleanup?.(); return; }
    const animation = element.animate(frames, timing(name, index));
    owners.set(element, animation); active.add(animation);
    const done = () => { active.delete(animation); if (owners.get(element) === animation) owners.delete(element); cleanup?.(); };
    animation.finished.then(done, done);
    return animation;
  }
  function reveal(element, name = 'fast', index = 0) {
    return play(element, [{ opacity: .65 }, { opacity: 1 }], name, index);
  }
  // Keep an inert visual copy outside layout, then remove the real content immediately.
  // Never retain active buttons, duplicate accessible names, or postpone the next action.
  function snapshot(element) {
    if (preference.matches || !element?.isConnected || element.hidden) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return;
    const copy = element.cloneNode(true);
    copy.removeAttribute('id');
    for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
    copy.inert = true; copy.setAttribute('aria-hidden', 'true'); copy.classList.add('motion-copy');
    Object.assign(copy.style, { position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0' });
    document.body.append(copy);
    return copy;
  }
  function dismiss(copy, crop = false) {
    if (!copy) return;
    play(copy, [{ opacity: 1, clipPath: 'inset(0 0 0 0)' },
      { opacity: 0, clipPath: crop ? 'inset(0 0 100% 0)' : 'inset(0 0 0 0)' }], 'exit', 0, () => copy.remove());
  }
  function remove(element) { const copy = snapshot(element); element?.remove(); dismiss(copy); }
  function hide(element) { const copy = snapshot(element); element.hidden = true; dismiss(copy); }
  function details(element) {
    const summary = element.querySelector('summary');
    if (!summary) return;
    summary.addEventListener('click', event => {
      if (event.defaultPrevented || event.target.closest('a, button, input')) return;
      event.preventDefault();
      const short = element.querySelectorAll('.execution-step').length <= listLimit;
      const copy = element.open && short ? snapshot(element) : null;
      element.open = !element.open;
      if (element.open && short) {
        reveal(element, 'base');
        let index = 0;
        for (const step of element.querySelectorAll('.execution-step')) reveal(step, 'fast', index++);
      } else dismiss(copy, true);
    });
  }
  function changed(element, key, name = 'fast') {
    if (element.dataset.motionKey === key) return;
    element.dataset.motionKey = key;
    reveal(element, name);
  }
  preference.addEventListener('change', () => { if (preference.matches) for (const animation of [...active]) animation.cancel(); });
  globalThis.WeftMotion = { reveal, snapshot, dismiss, remove, hide, details, changed, cancel, listLimit };
})();
