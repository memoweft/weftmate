export function captureThemeRollback(currentTheme, storedTheme) {
  return { theme: ['light', 'dark'].includes(currentTheme) ? currentTheme : 'system', storedTheme };
}

export function rollbackThemePreference(snapshot) {
  return { theme: snapshot.theme, storedTheme: snapshot.storedTheme };
}
