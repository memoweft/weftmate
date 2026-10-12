(() => {
  let choice='system';try{choice=localStorage.getItem('weftmate-site-theme')||'system';}catch{}
  const media=matchMedia('(prefers-color-scheme: dark)');
  function apply(){document.documentElement.dataset.theme=choice==='system'?(media.matches?'dark':'light'):choice;document.documentElement.dataset.themeChoice=choice;const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=document.documentElement.dataset.theme==='dark'?'#20211f':'#faf9f7';}
  apply();media.addEventListener('change',apply);
  window.weftmateTheme={set(value){if(!['system','light','dark'].includes(value))return;choice=value;try{localStorage.setItem('weftmate-site-theme',value);}catch{}apply();}};
})();
