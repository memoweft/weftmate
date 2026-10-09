export const quoteWindowsLoginArgs = args => args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg);
export function loginItemEnabled(value, name, path, platform = process.platform) {
  if (platform === 'win32' && Array.isArray(value.launchItems))
    return value.launchItems.some(item => item.name === name && item.scope === 'user' && item.enabled &&
      item.path.replace(/^"|"$/g, '').toLowerCase() === path.toLowerCase());
  return value.openAtLogin === true;
}
