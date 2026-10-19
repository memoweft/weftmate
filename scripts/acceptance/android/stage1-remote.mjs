/** Actions against the installed APK. Caller supplies the real loopback controller helpers. */
export async function observe({ phone, save }, name) {
  const state = await phone({ action: 'state' });
  await save(name + '.json', state);
  await save(name + '-tree.json', await phone({ action: 'tree' }));
  await phone({ action: 'shot', name });
  return state;
}

export async function createWork({ phone, until, delay }, projectId, approvalMode = 'ask') {
  await phone({ action: 'new', mode: 'work' });
  await until(async () => {
    const s = await phone({ action: 'state' });
    return s.foreground && !s.loading && !s.workBusy && !s.submitting;
  }, 30000);
  const choices = await phone({ action: 'choices' });
  const project = choices.projects.find(p => p.projectId === projectId);
  if (!project) throw Error('SelectAnActuallyAuthorizedProject');
  await until(async () => !(await phone({ action: 'state' })).workBusy, 15000);
  await phone({ action: 'project', project });
  await until(async () => {
    const s = await phone({ action: 'state' });
    return s.chatId && s.workProject?.projectId === projectId && !s.workBusy && !s.submitting && s.canSend;
  }, 30000);
  await phone({ action: 'approvalMode', value: approvalMode });
  await delay(300);
  await until(async () => !(await phone({ action: 'state' })).submitting, 15000);
  return phone({ action: 'state' });
}

export async function queueAndStop({ phone, save, delay, until }) {
  const initial = await phone({ action: 'state' });
  if (!initial.standalone || !initial.foreground) throw Error('ForegroundStandalonePhoneRequired');
  await phone({ action: 'new' }); await delay(700);
  await phone({ action: 'send', text: '请从1开始逐行输出到2000，每行一个数，不要省略。' });
  await delay(2000);
  const before = await phone({ action: 'state' }); await save('c3-ui-running.json', before);
  if (!before.running) throw Error('GenerationNotRunning');
  await phone({ action: 'send', text: 'B2排队复核：只回答QUEUE-RETEST。' });
  await save('c3-ui-queued.json', await phone({ action: 'state' }));
  const start = Date.now(); await phone({ action: 'clickLabel', label: '停止回复' });
  let ended = false;
  try { await until(async () => !(await phone({ action: 'state' })).running, 12000); ended = true; }
  catch { /* An observed timeout is evidence, not a pass. */ }
  const result = { ended, seconds: (Date.now() - start) / 1000, state: await phone({ action: 'state' }) };
  await save('c3-ui-stopped.json', result);
  return result;
}
