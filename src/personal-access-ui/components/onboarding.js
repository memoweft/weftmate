/* Installation journey composes existing authentication, diagnostics and pairing. */
globalThis.WeftUiComponents.factories.onboarding = (core, ui) => {
  const copy = globalThis.WeftOnboardingCopy;
  const steps = ['welcome', 'account', 'model', 'memory', 'import', 'phone', 'first'];
  let journey, panel, content, title, description, progress, next, back, skip, status, proceedModel;
  let renderIdentity = 0, generation = 0, mounted = false, active = false, tested = null, authPositions = [], pendingTimer, firstDraft;
  const node = (tag, cls, text) => ui.element(tag, cls, text);
  const button = (label, action, cls = 'secondary') => { const b = node('button', 'button ' + cls, label); b.type = 'button'; b.addEventListener('click', action); return b; };
  const say = text => { status.textContent = text; };
  const current = token => active && generation === token && renderIdentity === core.state.identityGeneration;
  function field(label, type = 'text', value = '') {
    const wrapper = node('label', 'onboarding-field', label), input = node('input');
    input.type = type; input.value = value; input.setAttribute('aria-label', label); wrapper.append(input); content.append(wrapper); return input;
  }
  async function persist(step, completed = false) {
    const value = await core.accessApi('/onboarding', { method: 'PATCH', body: { step, completed }, protectedWrite: !!core.state.csrfToken });
    journey = value.onboarding;
  }
  function restoreAuth() { for (const [element, parent, sibling] of authPositions) parent.insertBefore(element, sibling?.parentNode === parent ? sibling : null); authPositions = []; }
  function conceal() {
    active = false; generation++; clearTimeout(pendingTimer); restoreAuth(); panel.hidden = true;
    for (const element of document.body.children) if (element !== panel) element.inert = false;
    content.replaceChildren(); tested = null;
  }
  function reveal() {
    active = true; panel.hidden = false;
    for (const element of document.body.children) if (element !== panel && !['SCRIPT', 'LINK'].includes(element.tagName)) element.inert = true;
  }
  async function move(index) {
    next.disabled = back.disabled = skip.disabled = true;
    try { await persist(steps[index]); render(); } catch { say(copy.error); }
    finally { if (active) { skip.disabled = false; back.disabled = steps.indexOf(journey.step) === 0; } }
  }
  async function finish(requireModel = false, sample) {
    if(core.folderMutationPending?.())return;
    if (requireModel && (!core.state.account || !core.state.models.some(model => model.configured))) { say(copy.noModel); return; }
    try {
      const draft=sample||firstDraft?.value||'';
      await persist('first', true); conceal();
      if (core.state.account) {
        await core.enterAssistant();
        if (core.supportsChat?.('chats')) {await core.selectMainChat();if(core.defaultFolderProject?.())await core.openSideChat({entry:'composer',parent:{kind:'project',id:core.defaultFolderProject().projectId}});}
        showSamples();
        if (draft) ui.byId('message-text').value = draft;
        ui.byId('message-text').focus();
      } else { ui.showRegistration(); }
    } catch { say(copy.error); }
  }
  function render() {
    restoreAuth(); clearTimeout(pendingTimer); const token = ++generation; renderIdentity = core.state.identityGeneration;
    tested = null; proceedModel = null; const index = steps.indexOf(journey.step); reveal(); content.replaceChildren(); say('');
    title.textContent = copy.titles[index]; description.textContent = copy.descriptions[index];
    progress.setAttribute('aria-label', copy.progress(index, steps.length)); progress.replaceChildren();
    copy.steps.forEach((label, i) => { const dot = node('li', i === index ? 'is-current' : i < index ? 'is-done' : '', label); if (i === index) dot.setAttribute('aria-current', 'step'); progress.append(dot); });
    back.disabled = index === 0; next.textContent = index === 6 ? copy.start : copy.next; next.disabled = false;
    if (index === 0) content.append(node('span', 'wm-brand onboarding-brand'), node('p', 'onboarding-welcome', 'WeftMate'));
    if (index === 1) account(token);
    if (index >= 2 && !core.state.account) { content.append(node('p', '', copy.accountNeeded), button(copy.accountCloud, () => void move(1))); next.disabled = index === 6; }
    else if (index === 2) models(token);
    else if (index === 3) memory(token);
    else if (index === 4) { if(globalThis.WeftHistoryImportView)WeftHistoryImportView({target:content,request:core.accessApi,owner:()=>core.state.account?.ownerId,desktop:globalThis.weftmateDesktop?.previewHistoryImport?globalThis.weftmateDesktop:null}); }
    else if (index === 5) phone(token);
    else if (index === 6) {
      next.disabled = !core.state.models.some(model => model.configured);
      if (next.disabled) content.append(node('p', '', copy.noModel), button(copy.configure, () => void move(2)));
      else for (const [i, sample] of copy.samples.entries()) { const card = button(sample, () => void finish(true, sample), 'quiet onboarding-example'); card.prepend(WeftIcons.create(['compose','memory','clock'][i], 20)); content.append(card); }
      if(!next.disabled && globalThis.WeftFolderChoice){const composer=node('div','composer-card'),tools=node('div');firstDraft=node('textarea');firstDraft.rows=2;firstDraft.setAttribute('aria-label','第一句话');firstDraft.placeholder='想从什么开始？';composer.append(firstDraft,tools);content.append(composer);const folders=WeftFolderChoice.create(core,{form:composer,tools,toast:ui.toast,onboarding:true});folders.paint();void core.refreshSessionProjects().then(()=>folders.paint());}
    }
    title.focus();
  }
  function account(token) {
    if (core.state.account) {
      content.append(node('p', '', copy.accountDone));
      const input = field(copy.preferredName); input.maxLength = 80; content.append(node('p', 'muted', copy.nameHint));
      void core.accessApi('/settings/personalization').then(value => { if (current(token)) input.value = value.settings.preferredName; }).catch(() => { if (current(token)) { input.disabled = true; say(copy.nameUnavailable); } });
      input.addEventListener('change', async () => {
        try { await core.accessApi('/settings/personalization', { method: 'PATCH', body: { preferredName: input.value.trim() }, protectedWrite: true }); }
        catch { if (current(token)) say(copy.error); }
      }); return;
    }
    if (core.cloudAuthView?.().localDesktop) { content.append(node('p', 'muted', '本机账户暂时无法读取，请重试。'), button('重试读取', () => void core.load())); next.disabled = true; return; }
    const slot = node('div', 'onboarding-auth');
    const attach = () => { for (const id of ['login-view', 'setup-view', 'cloud-wait-view']) { const element = ui.byId(id); authPositions.push([element, element.parentNode, element.nextSibling]); slot.append(element); } };
    content.append(button(copy.accountCloud, () => { core.state.setupGrant = null; core.show('login'); core.startCloudJourney(); }),
      button(copy.accountLocal, () => ui.showRegistration()), slot);
    attach(); core.show('login'); core.startCloudJourney(); next.disabled = true;
  }
  function models(token) {
    const presets=[...copy.presets,{id:'custom',name:'自定义',baseUrl:'',url:'',help:'填写模型服务的地址和密钥。'}];
    let preset=presets[0],catalog=null,checking=0;
    const choose=button(preset.name,()=>WeftPopover.menu(choose,presets.map(p=>({name:p.name,action:()=>setPreset(p)}))));
    choose.setAttribute('aria-label','选择模型服务');choose.setAttribute('aria-haspopup','menu');content.append(choose);
    const help=node('p','muted'),link=node('a','',copy.getKey);link.target='_blank';link.rel='noopener noreferrer';content.append(help,link);
    const name=field('模型服务名称'),baseUrl=field('服务地址','url'),apiKey=field('密钥','password'),manual=field('模型名称（服务不提供清单时填写）');apiKey.autocomplete='off';
    manual.parentNode.hidden=true;
    const diagnostic=node('div','onboarding-diagnostic');diagnostic.setAttribute('role','status');content.append(diagnostic);
    const draft=()=>({name:name.value.trim(),baseUrl:baseUrl.value.trim(),apiKey:apiKey.value || (preset.id==='local'?'local-no-auth':''),interfaceType:preset.id==='anthropic'?'anthropic':'openai-compatible'});
    const fingerprint=()=>JSON.stringify(draft());
    function setPreset(p){preset=p;choose.textContent=p.name;name.value=p.name;baseUrl.value=p.baseUrl;apiKey.value='';manual.value='';help.textContent=p.help;link.href=p.url;link.hidden=!p.url;reset();}
    function reset(){catalog=null;checking++;diagnostic.textContent='';manual.parentNode.hidden=true;next.disabled=!baseUrl.value.trim();}
    async function query(){const generation=++checking,snapshot=fingerprint();diagnostic.textContent='正在读取模型…';try{
      const result=await core.checkModelService(draft());if(!current(token)||generation!==checking||snapshot!==fingerprint())return false;
      catalog=result.catalog||result;diagnostic.textContent=catalog.message;manual.parentNode.hidden=catalog.status==='available'&&catalog.models?.length>0;
      next.disabled=catalog.status==='authentication_failed';
      return true;
    }catch(error){if(current(token)&&generation===checking&&snapshot===fingerprint()){diagnostic.textContent=core.modelServiceFailureMessage(error);}return false;}
    }
    const check=button('重新查询模型',()=>void query());content.append(check);
    for(const input of [baseUrl,apiKey]){input.addEventListener('input',reset);input.addEventListener('blur',()=>{if(baseUrl.value&&apiKey.value)void query();});}
    proceedModel=async()=>{
      if(!draft().baseUrl){say('请填写模型服务地址。');return;}
      next.disabled=back.disabled=skip.disabled=true;say('正在保存模型服务…');
      try{if(!catalog&&!await query()){if(current(token))say(diagnostic.textContent);return;}if(!current(token))return;
        if(catalog?.status==='authentication_failed'){say(catalog.message);return;}
        if((!catalog?.models?.length)&&!manual.value.trim()){manual.parentNode.hidden=false;say('这个服务没有提供可用清单，请填写一个模型名称。');return;}
        const result=await core.writeModelService(null,{...draft(),...(manual.value.trim()?{modelId:manual.value.trim()}:{})});
        if(!current(token))return;apiKey.value='';const selected=result.service?.models?.find(m=>m.recommended&&m.enabled!==false)||result.service?.models?.find(m=>m.enabled!==false);
        if(selected)await core.selectServiceModel({serviceId:result.service.serviceId,modelId:selected.modelId});
        if(current(token))await move(3);
      }catch(error){if(current(token))say(core.modelServiceFailureMessage(error));}
      finally{if(current(token))next.disabled=back.disabled=skip.disabled=false;}
    };
    setPreset(preset);
  }
  function memory(token) {
    const list = node('dl', 'onboarding-memory'); for (const [label, text] of copy.memoryItems) list.append(node('dt', '', label), node('dd', '', text)); content.append(list);
    const health = node('p', 'muted', copy.healthLoading); health.setAttribute('role', 'status'); content.append(health);
    void core.accessApi('/memory/status').then(value => { if (current(token)) health.textContent = copy.healthLabel(core.memoryHealthText(value)); }).catch(() => { if (current(token)) health.textContent = copy.healthError; });
    void core.accessApi('/memory/backfill').then(value => { if (current(token) && value.turnCount > 0) content.append(node('p', 'muted', copy.backfillHint), button(copy.backfill, () => { conceal(); ui.openSettings('memory'); })); }).catch(() => {});
  }
  function phone() {
    content.append(node('p', 'muted', '在手机或其他电脑上打开 WeftMate，使用同一邮箱登录即可。电脑需要保持运行。'));
    if (core.state.cloudAuth.mode !== 'authenticated') content.append(
      node('p', 'muted', '远程访问需要登录。也可以先跳过，继续在这台电脑上使用。'),
      button('登录以使用远程访问', () => core.startCloudJourney(), 'primary'));
    else content.append(node('p', 'muted', '已登录。新设备首次登录时，用邮箱验证码确认是你本人。'));
    content.append(button(copy.deviceSettings, () => { conceal(); ui.openSettings('devices'); }));
  }
  function showSamples() {
    if (ui.byId('onboarding-samples')) return;
    const samples = node('div', 'onboarding-samples'); samples.id = 'onboarding-samples';
    for (const sample of copy.samples) samples.append(button(sample, () => { ui.byId('message-text').value = sample; ui.byId('message-text').focus(); }, 'quiet'));
    ui.byId('message-text').closest('form').prepend(samples);
    ui.byId('message-text').closest('form').addEventListener('submit', () => samples.remove(), { once: true });
  }
  async function startOnboarding(accountState) {
    if (!globalThis.weftmateDesktop || accountState.configured) return false;
    try { journey = (await core.accessApi('/onboarding')).onboarding; } catch { return false; }
    if (!journey || journey.completed) return false; if (!journey.started) await persist(journey.step); render(); return true;
  }
  async function resumeOnboarding() {
    if (!globalThis.weftmateDesktop || active) return;
    try { journey = (await core.accessApi('/onboarding')).onboarding; } catch { return; }
    if (journey?.started && !journey.completed) render();
  }
  function mountOnboarding() {
    if (mounted) return; mounted = true;
    panel = node('section', 'onboarding'); panel.hidden = true; panel.setAttribute('aria-label', '首次使用引导');
    const inner = node('div', 'onboarding-inner'); progress = node('ol', 'onboarding-progress');
    title = node('h1'); title.tabIndex = -1; description = node('p', 'onboarding-description'); content = node('div', 'onboarding-content');
    status = node('p', 'onboarding-status'); status.setAttribute('role', 'status');
    const footer = node('footer', 'onboarding-footer'); back = button(copy.back, () => void move(steps.indexOf(journey.step) - 1), 'quiet');
    skip = button(copy.skip, () => steps.indexOf(journey.step) === 6 ? void finish() : void move(steps.indexOf(journey.step) + 1), 'quiet');
    next = button(copy.next, () => journey.step === 'model' && proceedModel ? void proceedModel() : steps.indexOf(journey.step) === 6 ? void finish(true) : void move(steps.indexOf(journey.step) + 1), 'primary');
    footer.append(back, skip, next); inner.append(progress, title, description, content, status, footer); panel.append(inner); document.body.append(panel);
    const replay = button(copy.replay, async () => { ui.hideSettingsDialog(); try { await persist('welcome'); render(); } catch { ui.toast(copy.error); } });
    document.querySelector('section.settings-category[data-category="general"]').append(replay);
    const originalAvailability=ui.updateAvailability;
    ui.updateAvailability=(...args)=>{originalAvailability(...args);if(active&&journey?.step==='first')next.disabled=!core.state.models.some(model=>model.configured)||core.folderMutationPending?.()===true;};
    const originalCloudPaint = ui.paintCloudAuth;
    ui.paintCloudAuth = value => { originalCloudPaint(value); if (active && journey?.step === 'phone' && !value.modal && ['authenticated', 'offline'].includes(value.mode)) render(); };
    const originalPaint = ui.paintScreen;
    ui.paintScreen = view => { originalPaint(view); if (active && journey?.step === 'account') { if (core.state.account) render(); else reveal(); } };

  }
  return { mountOnboarding, startOnboarding, resumeOnboarding };
};
