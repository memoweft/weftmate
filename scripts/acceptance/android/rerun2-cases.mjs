/** Same-day absolute-time reminder and physical history-scroll acceptance helpers. */
export async function newRemoteChat({ phone, until }) {
  const previous = (await phone({ action: 'state' })).chatId;
  await phone({ action: 'new' });
  return until(async () => {
    const s = await phone({ action: 'state' });
    return s.chatId && s.chatId !== previous && s.sessionId && s.canSend &&
      !s.loading && !s.submitting && !s.workBusy && s;
  }, 45000);
}

export function absoluteReminder(now = Date.now(), leadMinutes = 6, marker = 'B2-R2-H5') {
  const at = new Date(Math.ceil((now + leadMinutes * 60000) / 60000) * 60000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return { at: at.toISOString(), day: `${parts.year}-${parts.month}-${parts.day}`,
    timeZone: 'Asia/Shanghai', time, marker,
    prompt: `今天 ${time} 提醒我「${marker}」。按本地时间创建一次性提醒，不执行其他工作。` };
}

export async function historyScroll({ phone, save, delay }, conversationId) {
  await phone({ action: 'select', chat: { id: conversationId, nativePhone: true, title: 'B2 synthetic history' } });
  await delay(800);
  const before = await phone({ action: 'state' });
  await save('c4-open.json', before);
  await save('c4-latest-tree.json', await phone({ action: 'tree' }));
  await phone({ action: 'shot', name: 'c4-latest' });
  await phone({ action: 'historySwipe' });
  await phone({ action: 'historySwipe' });
  await delay(500);
  await save('c4-older-tree.json', await phone({ action: 'tree' }));
  await phone({ action: 'shot', name: 'c4-older' });
  return { storedMessages: before.rows.length, chatId: before.chatId, running: before.running };
}

export async function formedDialogueForget({ phone, web, save, delay, until }) {
  const reply = s => s.rows.filter(r => r.type === 'assistant.message').map(r => r.data.text).join('\n');
  await phone({ action: 'new' }); await delay(700);
  await phone({ action: 'send', text: '请记住我的合成测试偏好：我喜欢的运动是游泳。' });
  await until(async () => { const s = await phone({ action: 'state' }); return !s.running && s.rows.some(r => r.type === 'assistant.message'); }, 90000);
  let memory;
  await until(async () => { memory = await web('JSON.stringify(WeftPhone.memory)'); return memory.items.some(r => r.text.includes('游泳')); }, 90000);
  await save('m7-confirmed-before.json', memory);
  await phone({ action: 'send', text: '请忘掉我喜欢游泳这项偏好。' });
  await until(async () => { const s = await phone({ action: 'state' }); return !s.running && reply(s).includes('忘'); }, 90000);
  await save('m7-confirmed-receipt.json', await phone({ action: 'state' }));
  await save('m7-confirmed-after.json', await web('JSON.stringify(WeftPhone.memory)'));
  await phone({ action: 'new' }); await delay(700);
  await phone({ action: 'send', text: '我喜欢什么运动？' });
  const s = await until(async () => { const s = await phone({ action: 'state' }); return !s.running && s.rows.some(r => r.type === 'assistant.message') && s; }, 90000);
  await save('m7-confirmed-recall.json', s);
  return { reply: reply(s), memory: await web('JSON.stringify(WeftPhone.memory)') };
}
