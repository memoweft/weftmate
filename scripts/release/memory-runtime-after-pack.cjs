module.exports = async context => {
  await (await import('../memory-runtime-package.mjs')).afterWindowsMemoryPack(context);
  if(context.electronPlatformName==='win32'){
    await (await import('../windows-runtime-components.mjs')).prepareWindowsRuntimeComponents(context);
    await require('./installer-assets.cjs').compile(context);
  }
};
