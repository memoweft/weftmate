/* Native renderers consume data and named actions; the shared engine owns every operation. */
(() => {
  const pages = new Map();
  const text = (label, detail = '') => ({type:'text', label:String(label ?? ''), detail:String(detail ?? '')});
  const action = (label, id, params = {}, extra = {}) => ({type:'action', label, action:id, params, ...extra});
  const navigate = (label, page, params = {}, detail = '') => ({type:'navigate', label, page, params, detail});
  const input = (key, label, value = '', extra = {}) => ({type:'input', key, label, value:String(value ?? ''), ...extra});
  const toggle = (key, label, value, action, detail = '') => ({type:'toggle', key, label, value:!!value, action, detail});
  const choice = (key, label, value, options, action, detail = '') => ({type:'choice', key, label, value, options:options.map(([value,label])=>({value,label})), action, detail});
  const section = (title, rows) => ({title, rows:rows.filter(Boolean)});
  const view = (title, sections, extra = {}) => ({title, sections:sections.filter(Boolean), ...extra});
  const date = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false}) : '尚无记录';
  function identity(c) { return [c.state.authEpoch, c.core.state.identityGeneration, c.state.owner].join(':'); }
  async function request(c, page, command = 'read', p = {}, values = {}) {
    const handler = pages.get(page);
    if (!handler) throw Error('这个页面暂时无法打开，请返回后重试。');
    c.core.syncMobileIdentity?.();
    if (c.expectedOwner !== undefined && c.expectedOwner !== c.state.owner) throw Error('账户已切换，请重新打开。');
    const token = identity(c);
    const current = () => token === identity(c);
    const ctx = {...c, current};
    let result;
    try {
    if (command !== 'read') {
      if (!handler.act) throw Error('这个操作暂时不可用，请重新打开页面。');
      result = await handler.act(ctx, command, p, values);
      if (!current() && !result?.authenticated) throw Error('账户已切换，请重新打开。');
      if (result?.effect) return result;
    }
    const value = await handler.read(ctx, p);
    if (!current() && !result?.authenticated) throw Error('账户已切换，请重新打开。');
    return {view:value, message:result?.message || '', resetValues:result?.resetValues===true};
    } catch(error) {
      if (!current()) throw Error('账户已切换，请重新打开。');
      if (c.humanError) throw Error(c.humanError(error,page));
      throw error;
    }
  }
  globalThis.WeftUiCore.nativePresentation = {version:1, register:(id,handler)=>pages.set(id,handler), request,
    text,action,navigate,input,toggle,choice,section,view,date};
})();
