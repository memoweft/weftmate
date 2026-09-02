/** Select the settings editor target without letting stale row selection win. */
export function editorProfileForSettings(mode, activeProfile, selectedProfile) {
  if (mode === 'new') return null;
  if (mode === 'edit') return activeProfile ?? null;
  return selectedProfile ?? null;
}
