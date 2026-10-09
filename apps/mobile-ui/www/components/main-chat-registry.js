/* The measured timeline renderer is generated from the desktop presentation motherplate. */
globalThis.WeftUiComponents ||= { factories: {} };
globalThis.WeftIcons ||= { create(name) {
  const icon = document.createElement('img'); icon.src = `icons/${name}.svg`;
  icon.alt = ''; icon.setAttribute('aria-hidden','true'); return icon;
} };
