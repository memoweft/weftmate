/** Product observations for the 10-19 same-commit run. No synthetic service responses. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const text = state => state.rows.filter(row => row.type === 'assistant.message').map(row => row.data?.text || '').join('\n');

export async function chat({ phone, save, until, delay }) {
  await phone({ action: 'new' }); await delay(500);
  for (const message of ['第一条B2：用300字说明水循环，结尾写FIRST。', '第二条B2：只回答SECOND。', '第三条B2：只回答THIRD。']) {
    await phone({ action: 'send', text: message }); await delay(1500);
  }
  let s;
  try { await until(async () => { s = await phone({ action: 'state' }); return !s.running && s.rows.filter(r => r.type === 'user.message').length === 3; }, 90000); }
  catch { /* Save the actual failure and let the operator continue the next scene. */ }
  await save('c7-final.json', s); await phone({ action: 'shot', name: 'c7-final' });
  const c7 = { users: s.rows.filter(r => r.type === 'user.message').length, answers: s.rows.filter(r => r.type === 'assistant.message').length, reply: text(s), running: s.running };
  if (s.running) return { c7, c6Blocked: 'Previous generation did not finish' };
  await phone({ action: 'new' }); await delay(500);
  await phone({ action: 'send', text: '请写一篇1800字中文文章，说明海洋的形成过程。' }); await delay(2000);
  const mid = await phone({ action: 'state' }); await save('c6-streaming.json', mid);
  await phone({ action: 'clickLabel', label: '健康' }); await phone({ action: 'shot', name: 'c6-away' });
  await delay(1500); await phone({ action: 'clickLabel', label: '聊天' });
  await until(async () => { s = await phone({ action: 'state' }); return !s.running && s.rows.some(r => r.type === 'assistant.message'); }, 120000);
  await save('c6-complete.json', s); await phone({ action: 'shot', name: 'c6-complete' });
  return { c7, c6: { switchedWhileRunning: mid.running, characters: text(s).length, reply: text(s) } };
}

export async function memory({ phone, web, save, until, delay, evidence }, part = 'all') {
  const observations = part === 'finish' ? JSON.parse(await readFile(join(evidence, 'memory-first.json'), 'utf8')) : {};
  async function fresh() { await phone({ action: 'new' }); await delay(500); }
  async function ask(message, name) {
    await phone({ action: 'send', text: message });
    let s;
    try { await until(async () => { s = await phone({ action: 'state' }); return !s.running && s.rows.some(r => r.type === 'user.message' && r.data?.text === message) && s.rows.some(r => r.type === 'assistant.message'); }, 90000); }
    finally { if (s) await save(name + '.json', s); }
    return text(s);
  }
  async function memoryView() { return web('JSON.stringify(WeftPhone.memory)'); }
  async function click(label) {
    const result = await web(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().height&&e.innerText.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`);
    if (!result) throw Error('Memory button missing: ' + label); await delay(200);
  }
  if (part !== 'finish') {
  await phone({ action: 'page', name: 'chat' }); await fresh();
  await ask('记住我喜欢喝红茶。', 'm1-formation'); await delay(25000);
  observations.m1Memory = await memoryView(); await save('m1-memory.json', observations.m1Memory);
  await fresh(); observations.m1Reply = await ask('我喜欢喝什么？', 'm1-recall');
  await ask('我其实更喜欢绿茶，请记住这个纠正。', 'm2-correction'); await delay(25000);
  observations.m2Memory = await memoryView(); await save('m2-memory.json', observations.m2Memory);
  await fresh(); observations.m2Reply = await ask('我喜欢喝什么？', 'm2-recall');
  await save('memory-first.json', observations);
  if (part === 'start') return observations;
  }
  await phone({ action: 'settings', name: 'memory' }); await delay(400);
  const before = await memoryView(); await save('m3-before.json', before);
  const item = before.items.find(item => /绿茶|红茶/.test(item.text));
  if (item) {
    await web(`(()=>{const label=${JSON.stringify('记忆的更多操作：' + item.text)};const b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===label);if(!b)return false;b.click();return true})()`);
    await click('忘掉'); await click('确认忘掉'); await delay(300);
    observations.m3Memory = await memoryView(); await save('m3-after.json', observations.m3Memory);
    await phone({ action: 'page', name: 'chat' }); await fresh(); observations.m3Reply = await ask('我喜欢喝什么？', 'm3-recall');
  } else observations.m3Blocked = 'Formation did not produce the target memory';
  await phone({ action: 'page', name: 'chat' }); await fresh();
  await ask('记住我喜欢喝白茶。', 'm7-formation'); await delay(25000);
  observations.m7Before = await memoryView(); await save('m7-before.json', observations.m7Before);
  observations.m7DeleteReply = await ask('请忘掉我喜欢喝白茶这个偏好。', 'm7-forget'); await delay(1000);
  observations.m7After = await memoryView(); await save('m7-after.json', observations.m7After);
  await fresh(); observations.m7Reply = await ask('我喜欢喝什么？', 'm7-recall');
  await save('memory-observations.json', observations);
  await save('memory-chat-originals.json', await phone({ action: 'call', method: 'phone.offline.load' }));
  return observations;
}
