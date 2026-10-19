import assert from 'node:assert/strict';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

const fixture=await sourceModelDesktop('528');
const {page,until,capture,events,send,report}=fixture;
let failure;
try{
  await page.evaluate(()=>scenarioCore.startNewConversation());
  await send('What reminder is already saved in my account for later tonight? Read the actual reminder list. Do not create, delete or change any reminder. Reply in English.');
  const id=await until(()=>page.evaluate(()=>scenarioCore.state.selectedSessionId),'English session');
  const rows=await until(async()=>{const rows=await events(id);return rows.some(e=>e.type==='turn.ended')&&rows;},'English reminder reply');
  assert.ok(rows.some(e=>e.type==='step.started'&&e.data.toolName==='schedule_list'),'actual reminder list tool was used');
  assert.equal(rows.some(e=>e.type==='step.started'&&/^(schedule_create|schedule_delete|schedule_manage)$/.test(e.data.toolName)),false,'read-only request changed no reminders');
  const reply=rows.filter(e=>e.type==='assistant.message').at(-1).data.text;
  assert.match(reply,/[A-Za-z]/);assert.doesNotMatch(reply,/\p{Script=Han}/u);
  await until(async()=> {const titles=await page.locator('.inline-progress-text').allTextContents();return titles.includes('Handled 1 scheduling action')&&titles.every(text=>! /\p{Script=Han}/u.test(text));},'completed English progress title');
  report.title=await page.locator('.inline-progress-text').allTextContents();
  for(const label of report.title)assert.doesNotMatch(label,/\p{Script=Han}/u);
  await capture('collapsed');
  await page.locator('.execution-block').evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;}));
  await until(async()=> (await page.locator('.execution-step > summary').allTextContents()).some(text=>text.includes('List schedules')),'English expanded steps');
  report.steps=await page.locator('.execution-step > summary').allTextContents();
  assert.ok(report.steps.some(text=>text.includes('Prepare tools')));
  for(const label of report.steps)assert.doesNotMatch(label,/\p{Script=Han}/u);
  await capture('expanded');
  const schedule=page.locator('.execution-step').filter({has:page.locator('summary',{hasText:'List schedules'})}).first();
  await schedule.locator('summary').click();
  await until(async()=> (await schedule.locator('pre').innerText()).includes('Output'),'actual step detail');
  assert.ok((await schedule.locator('pre').innerText()).includes('Output'));
  await capture('step-detail');
  report.passed=true;report.scheduleListCalls=rows.filter(e=>e.type==='step.started'&&e.data.toolName==='schedule_list').length;
  console.log('528 PASS: English answer, progress title, expanded steps and real detail');
}catch(error){failure=error;await capture('failure').catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{await fixture.close(failure);}
