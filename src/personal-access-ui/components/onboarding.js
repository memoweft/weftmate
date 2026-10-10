/* Installation journey composes existing authentication, diagnostics and pairing. */
globalThis.WeftUiComponents.factories.onboarding = (core, ui) => {
  const copy = globalThis.WeftOnboardingCopy;
  const steps = ['welcome', 'account', 'model', 'memory', 'import', 'phone', 'first'];
  let journey, panel, content, title, description, progress, next, back, skip, status, proceedModel;
  let renderIdentity = 0, generation = 0, mounted = false, active = false, tested = null, authPositions = [], pendingTimer;
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
    if (requireModel && (!core.state.account || !core.state.models.some(model => model.configured))) { say(copy.noModel); return; }
    try {
      await persist('first', true); conceal();
      if (core.state.account) {
        await core.enterAssistant();
        if (core.supportsChat?.('chats')) await core.selectMainChat();
        showSamples();
        if (sample) ui.byId('message-text').value = sample;
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
    else if (index === 4) { const disabled = button(copy.importSoon, () => {}); disabled.disabled = true; content.append(disabled); }
    else if (index === 5) phone(token);
    else if (index === 6) {
      next.disabled = !core.state.models.some(model => model.configured);
      if (next.disabled) content.append(node('p', '', copy.noModel), button(copy.configure, () => void move(2)));
      else for (const [i, sample] of copy.samples.entries()) { const card = button(sample, () => void finish(true, sample), 'quiet onboarding-example'); card.prepend(WeftIcons.create(['compose','memory','clock'][i], 20)); content.append(card); }
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
    const slot = node('div', 'onboarding-auth');
    const attach = () => { for (const id of ['login-view', 'setup-view', 'cloud-wait-view']) { const element = ui.byId(id); authPositions.push([element, element.parentNode, element.nextSibling]); slot.append(element); } };
    content.append(button(copy.accountCloud, () => { core.state.setupGrant = null; core.show('login'); core.startCloudJourney(); }),
      button(copy.accountLocal, () => ui.showRegistration()), slot);
    attach(); core.show('login'); core.startCloudJourney(); next.disabled = true;
  }
  function models(token) {
    const select = node('select'); select.setAttribute('aria-label', copy.modelProvider);
    const label = node('label', 'onboarding-field', copy.modelProvider); label.append(select); content.append(label);
    for (const preset of copy.presets) select.append(new Option(preset.name, preset.id));
    const help = node('p', 'muted'), link = node('a', '', copy.getKey); link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(help, link);
    const name = field(copy.modelName), baseUrl = field(copy.modelAddress, 'url'), modelId = field(copy.modelId), apiKey = field(copy.modelKey, 'password'); apiKey.autocomplete = 'off';
    const advanced = node('details', 'onboarding-advanced'), summary = node('summary', '', copy.advanced); advanced.append(summary, name.parentNode, baseUrl.parentNode, modelId.parentNode); content.insertBefore(advanced, apiKey.parentNode);
    const diagnostic = node('div', 'onboarding-diagnostic'); diagnostic.setAttribute('role', 'status');
    const markerKey = 'weftmate.onboarding.model:' + core.state.account.ownerId;
    async function reconcileSavedModel(requestId) {
      let receipt;
      do {
        receipt = await core.accessApi('/account/models/by-request/' + requestId); if (!current(token)) return;
        if (['pending', 'applying'].includes(receipt.operation?.status)) await new Promise(resolve => setTimeout(resolve, 250));
      } while (['pending', 'applying'].includes(receipt.operation?.status));
      if (receipt.operation?.status === 'uncertain') { say(copy.modelUncertain); return false; }
      localStorage.removeItem(markerKey);
      if (receipt.operation?.status !== 'succeeded' || !receipt.model?.profileId) throw new Error('save failed');
      await core.saveDefaultModel(receipt.model.profileId); await core.refreshModels(); if (current(token)) say(copy.modelSaved); return true;
    }
    const draft = () => ({ baseUrl: baseUrl.value.trim(), modelId: modelId.value.trim(), apiKey: apiKey.value || (select.value === 'local' ? 'local-no-auth' : '') });
    const fingerprint = () => JSON.stringify(draft());
    const reset = () => { tested = null; next.disabled = true; diagnostic.replaceChildren(); };
    const choosePreset = () => { const p = copy.presets.find(p => p.id === select.value); name.value = p.name; baseUrl.value = p.baseUrl; modelId.value = p.modelId; apiKey.value = ''; help.textContent = p.help; link.href = p.url; advanced.open = ['local', 'openai', 'anthropic', 'doubao'].includes(p.id); reset(); };
    select.addEventListener('change', choosePreset);
    for (const input of [baseUrl, modelId, apiKey]) input.addEventListener('input', reset);
    const check = button(copy.check, async () => {
      check.disabled = true; say(copy.checking); const snapshot = fingerprint();
      try {
        const result = await core.checkModelConnection(draft());
        if (!current(token) || snapshot !== fingerprint()) return;
        diagnostic.replaceChildren();
        for (const [label, detail] of core.modelConnectionSteps(result)) diagnostic.append(node('p', '', label + '：' + detail));
        if (result.modelListed || result.inferenceVerified) { tested = snapshot; next.disabled = false; say(''); }
        else if (result.requiresTestMessage) {
          diagnostic.append(button(copy.testMessage, async () => {
            try { const verified = await core.checkModelConnection({ ...draft(), sendTestMessage: true }); if (current(token) && snapshot === fingerprint()) { diagnostic.replaceChildren(...core.modelConnectionSteps(verified).map(([a,b]) => node('p','',a+'：'+b))); if (verified.inferenceVerified) { tested = snapshot; next.disabled = false; } } } catch { if (current(token)) say(copy.error); }
          })); say('');
        } else say(copy.checkFirst);
      } catch { if (current(token)) say(copy.error); } finally { if (current(token)) check.disabled = false; }
    });
    proceedModel = async () => {
      if (tested !== fingerprint()) { say(copy.checkFirst); return; }
      next.disabled = back.disabled = skip.disabled = true; check.disabled = true; say(copy.saving);
      const requestId = crypto.randomUUID(), body = { requestId, name: name.value.trim() || modelId.value.trim(), ...draft(), modelTier: select.value === 'local' ? 'local' : 'cloud' };
      try {
        localStorage.setItem(markerKey, requestId);
        await core.saveAccountModel(null, body); apiKey.value = '';
        if (await reconcileSavedModel(requestId) && current(token)) await move(3);
      } catch (error) { if (error.status && [400, 403, 422].includes(error.status)) localStorage.removeItem(markerKey); if (current(token)) say(copy.error); } finally { if (current(token)) { back.disabled = skip.disabled = false; if (!localStorage.getItem(markerKey)) check.disabled = false; } }
    };
    content.append(node('p', 'muted', copy.localKeyHint), check, diagnostic);
    choosePreset();
    const savedRequest = localStorage.getItem(markerKey);
    if (savedRequest) { check.disabled = next.disabled = true; say(copy.modelPending); void reconcileSavedModel(savedRequest).then(saved => { if (saved && current(token)) { proceedModel = () => move(3); next.disabled = false; } }).catch(() => { if (current(token)) say(copy.modelUncertain); }).finally(() => { if (current(token) && !localStorage.getItem(markerKey)) check.disabled = false; }); }
    content.append(node('hr'), node('p', 'muted', copy.discoveryHint)); const additional = field(copy.additional, 'url');
    const discovered = node('div');
    const discover = button(copy.discover, async () => {
      discover.disabled = true; say(copy.discoveryBusy);
      try {
        const value = await core.accessApi('/models/discover', { method: 'POST', protectedWrite: true, body: { addresses: additional.value.trim() ? [additional.value.trim()] : [] }, timeoutMs: 30000 });
        if (!current(token)) return; discovered.replaceChildren();
        for (const result of value.results) for (const id of result.models) discovered.append(button(copy.choose + ' ' + id, () => { select.value = 'local'; choosePreset(); baseUrl.value = result.baseUrl; modelId.value = id; name.value = id; baseUrl.focus(); }, 'quiet'));
        say(value.results.length ? '' : copy.discoveryEmpty);
      } catch { if (current(token)) say(copy.error); } finally { if (current(token)) discover.disabled = false; }
    }); content.append(discover, discovered);
  }
  function memory(token) {
    const list = node('dl', 'onboarding-memory'); for (const [label, text] of copy.memoryItems) list.append(node('dt', '', label), node('dd', '', text)); content.append(list);
    const health = node('p', 'muted', copy.healthLoading); health.setAttribute('role', 'status'); content.append(health);
    void core.accessApi('/memory/status').then(value => { if (current(token)) health.textContent = copy.healthLabel(core.memoryHealthText(value)); }).catch(() => { if (current(token)) health.textContent = copy.healthError; });
    void core.accessApi('/memory/backfill').then(value => { if (current(token) && value.turnCount > 0) content.append(node('p', 'muted', copy.backfillHint), button(copy.backfill, () => { conceal(); ui.openSettings('memory'); })); }).catch(() => {});
  }
  function phone(token) {
    content.append(node('p', 'muted', copy.pairRefresh));
    const qr = node('img', 'onboarding-qr'); qr.alt = copy.pairQr; qr.hidden = true;
    const code = node('textarea'); code.readOnly = true; code.setAttribute('aria-label', copy.pairCode); code.hidden = true;
    const devices = node('div');
    const pair = button(copy.pair, async () => {
      pair.disabled = true; say(copy.pairLoading);
      try {
        const result = await core.cloudPairing(), value = globalThis.WeftCloud.pairingCode(result);
        const data = await globalThis.WeftCloudVendor.QRCode.toDataURL((result.relay?.baseUrl || result.origin) + '/personal/v1/ui/#pair=' + value.slice(4));
        if (!current(token)) return; qr.src = data; code.value = value; qr.hidden = code.hidden = false; say('');
      } catch { if (current(token)) say(copy.pairOffline); } finally { if (current(token)) pair.disabled = false; }
    });
    content.append(pair, qr, code, devices, button(copy.deviceSettings, () => { conceal(); ui.openSettings('devices'); }));
    const poll = async () => {
      try {
        const pending = await core.readPendingDevices(); if (!current(token)) return; devices.replaceChildren();
        for (const device of pending.devices || []) {
          const row = node('div', 'onboarding-device', device.name);
          for (const [decision, label] of [['allow', '允许'], ['deny', '拒绝']]) row.append(button(label + ' ' + device.name, async () => { try { await ui.decideCloudDevice(device, decision); if (current(token)) void poll(); } catch { if (current(token)) say(copy.error); } }));
          devices.append(row);
        }
      } catch {} finally { if (current(token)) pendingTimer = setTimeout(poll, 2000); }
    }; void poll();
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
    const originalPaint = ui.paintScreen;
    ui.paintScreen = view => { originalPaint(view); if (active && journey?.step === 'account') { if (core.state.account) render(); else reveal(); } };

  }
  return { mountOnboarding, startOnboarding, resumeOnboarding };
};
