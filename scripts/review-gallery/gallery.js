const captureTheme = document.getElementById('capture-theme');
captureTheme.addEventListener('change', () => document.querySelectorAll('[data-capture-theme]').forEach(node => { node.hidden = node.dataset.captureTheme !== captureTheme.value; }));
const pageTheme = document.getElementById('page-theme'), system = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => { document.documentElement.dataset.theme = pageTheme.value === 'system' ? system.matches ? 'dark' : 'light' : pageTheme.value; };
pageTheme.addEventListener('change', applyTheme); system.addEventListener('change', applyTheme); applyTheme();
const viewer = document.querySelector('dialog'), image = document.createElement('img'); image.id = 'viewer-image';
document.querySelectorAll('.capture').forEach(button => button.addEventListener('click', () => {
  const source = button.querySelector('img'); image.src = source.src; image.alt = source.alt;
  document.getElementById('viewer-canvas').replaceChildren(image);
  document.getElementById('viewer-title').textContent = button.getAttribute('aria-label').replace(/^放大/, '');
  document.getElementById('viewer-provenance').textContent = button.parentElement.querySelector('.provenance').innerText;
  viewer.showModal();
}));
document.getElementById('close-viewer').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', event => { if (event.target === viewer) { const box = viewer.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) viewer.close(); } });
