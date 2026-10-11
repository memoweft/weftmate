/** Synthetic gallery transport. Capabilities and responses must describe the
 * same fixture, including Android's direct bridge (not browser HTTP routes). */
export function galleryBridge(fixture, theme, { suggestions } = {}) {
  return async payload => {
    if (payload.method === 'settings.appearance') return { value: theme };
    if (suggestions && payload.method === 'host.business' && payload.params?.path?.includes('/suggestions'))
      return { requestId: payload.params.body?.requestId, suggestions,
        completion: payload.params.body?.kind === 'completion' ? '保存成文件' : '', available: true };
    const result = await fixture.mobileBridge(payload);
    if (suggestions && (payload.method === 'host.status' || payload.method === 'host.business' && payload.params?.path === '/personal/v1/status'))
      return { ...result, personalCapabilities: { ...result.personalCapabilities, nextSuggestions: 1 } };
    return result;
  };
}
