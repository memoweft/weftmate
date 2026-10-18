const scheme = matchMedia('(prefers-color-scheme: dark)');
const update = () => { document.documentElement.dataset.theme = scheme.matches ? 'dark' : 'light'; };
update();
scheme.addEventListener('change', update);
