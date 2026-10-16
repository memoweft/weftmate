module.exports = async context => (await import('../memory-runtime-package.mjs')).afterWindowsMemoryPack(context);
