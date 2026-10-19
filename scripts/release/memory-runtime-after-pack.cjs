module.exports = async context => {
  await (await import('../memory-runtime-package.mjs')).afterWindowsMemoryPack(context);
  if(context.electronPlatformName==='win32')await require('./installer-assets.cjs').compile(context);
};
