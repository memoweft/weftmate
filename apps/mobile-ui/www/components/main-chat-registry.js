/* The measured timeline renderer is generated from the desktop presentation motherplate. */
globalThis.WeftUiComponents ||= { factories: {} };
globalThis.WeftIcons ||= { create(name) {
  const icon = document.createElement('span'); icon.className=`icon icon-${name}`;
  icon.setAttribute('aria-hidden','true'); return icon;
} };
