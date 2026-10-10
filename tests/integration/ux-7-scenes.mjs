/** Synthetic responses with production suggestion rendering; no model or personal data. */
export const ux7Replies = ['把它保存成文件', '继续说第二点', '帮我设个提醒'];
const routeStates = new WeakMap();
function routeState(page) {
  if(!routeStates.has(page)){
    const state={closing:false,documentEpoch:0,errors:[]};routeStates.set(page,state);
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())state.documentEpoch++;});
    page.on('close',()=>{state.closing=true;});
  }
  return routeStates.get(page);
}
function routeHandler(page, name, action) {
  const state=routeState(page);
  return async route=>{const documentEpoch=state.documentEpoch;
    try{if(state.closing||page.isClosed())return await route.abort().catch(()=>{});await action(route);}
    catch(error){const cancelledDocument=documentEpoch!==state.documentEpoch||route.request().failure()?.errorText==='net::ERR_ABORTED';
      if(!state.closing&&!page.isClosed()&&!cancelledDocument)state.errors.push({route:name,code:error.code||error.name||'ROUTE_FAILED'});await route.abort().catch(()=>{});}};
}
export function assertUx7RouteErrors(page) { const errors=routeState(page).errors;if(errors.length)throw Error(`UX-7 route infrastructure failed: ${JSON.stringify(errors)}`); }
export async function closeUx7Routes(page) { routeState(page).closing=true;if(!page.isClosed())await page.unrouteAll({behavior:'wait'}).catch(()=>{}); }
export async function exposeUx7Desktop(page) {
  await page.route('**/personal/v1/ui/app.js', routeHandler(page,'app',async route => {
    const response = await route.fetch();
    const code = (await response.text()).replace('const ui = globalThis.WeftUiComponents.createContext();',
      'const ui = globalThis.__ux7ui = globalThis.WeftUiComponents.createContext();')
      .replace('const core = globalThis.WeftUiCore.create(', 'const core = globalThis.__ux7core = globalThis.WeftUiCore.create(');
    await route.fulfill({ response, body: code });
  }));
}
export async function mockUx7Requests(page, readReplies = () => ux7Replies, { legacy = false } = {}) {
  await page.route('**/personal/v1/status', routeHandler(page,'status',async route => {
    const response=await route.fetch(), body=await response.json();
    await route.fulfill({response,json:{...body,personalCapabilities:{...(legacy?{}:body.personalCapabilities),nextSuggestions:1}}});
  }));
  await page.route('**/personal/v1/sessions/*/suggestions*', routeHandler(page,'suggestions',async route => {
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    await route.fulfill({ json: { requestId: input.requestId, suggestions: readReplies(),
      completion: input.kind === 'completion' ? '保存成文件' : '', available: true } });
  }));
  await page.route('**/bridge', routeHandler(page,'bridge',async route => {
    const input = route.request().postDataJSON();
    if (input.method !== 'host.business' || !input.params?.path?.includes('/suggestions')) return route.fallback();
    await route.fulfill({ json: { result: { requestId: input.params.body?.requestId,
      suggestions: readReplies(), completion: input.params.body?.kind === 'completion' ? '保存成文件' : '', available: true } } });
  }));
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
