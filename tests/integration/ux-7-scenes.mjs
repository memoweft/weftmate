/** Synthetic responses with production suggestion rendering; no model or personal data. */
export const ux7Replies = ['把它保存成文件', '继续说第二点', '帮我设个提醒'];
export async function exposeUx7Desktop(page) {
  await page.route('**/personal/v1/ui/app.js', async route => {
    const response = await route.fetch();
    const code = (await response.text()).replace('const ui = globalThis.WeftUiComponents.createContext();',
      'const ui = globalThis.__ux7ui = globalThis.WeftUiComponents.createContext();')
      .replace('const core = globalThis.WeftUiCore.create(', 'const core = globalThis.__ux7core = globalThis.WeftUiCore.create(');
    await route.fulfill({ response, body: code });
  });
}
export async function mockUx7Requests(page, readReplies = () => ux7Replies, { legacy = false } = {}) {
  await page.route('**/personal/v1/status', async route => {
    const response=await route.fetch(), body=await response.json();
    await route.fulfill({response,json:{...body,personalCapabilities:{...(legacy?{}:body.personalCapabilities),nextSuggestions:1}}});
  });
  await page.route('**/personal/v1/sessions/*/suggestions*', async route => {
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    await route.fulfill({ json: { requestId: input.requestId, suggestions: readReplies(),
      completion: input.kind === 'completion' ? '保存成文件' : '', available: true } });
  });
  await page.route('**/bridge', async route => {
    const input = route.request().postDataJSON();
    if (input.method !== 'host.business' || !input.params?.path?.includes('/suggestions')) return route.fallback();
    await route.fulfill({ json: { result: { requestId: input.params.body?.requestId,
      suggestions: readReplies(), completion: input.params.body?.kind === 'completion' ? '保存成文件' : '', available: true } } });
  });
}
export async function prepareUx7Suggestions(page) {
  await page.evaluate(async () => {
    const core = globalThis.__ux7core || uiCore;
    core.state.personalCapabilities = { ...core.state.personalCapabilities, nextSuggestions: 1 };
    core.state.personalization = { ...core.state.personalization, nextSuggestionsEnabled: true };
    core.cancelNextSuggestions();
    const draft = document.querySelector('#message-text, #draft'); draft.value = '';
    core.nextSuggestionsInput('');
    await core.requestNextSuggestions('replies');
  });
  await page.locator('.next-suggestion-chip').first().waitFor();
}
