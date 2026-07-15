import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8');
const firstInterview = readFileSync(new URL('../src/first-interview.ts', import.meta.url), 'utf8');

function routeSet(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/req\.method\s*===\s*'([A-Z]+)'\s*&&\s*url\.pathname\s*===\s*'([^']+)'/g)]
      .map((match) => `${match[1]} ${match[2]}`),
  );
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `找不到源码区间：${start} -> ${end}`);
  return source.slice(from, to);
}

describe('统一产品入口契约', () => {
  it('旧聊天/向导端点消失，统一 Agent、历史和模型设置端点保留', () => {
    const routes = routeSet(server);

    for (const removed of [
      'POST /api/chat',
      'POST /api/gen-env',
      'POST /api/model-config',
    ]) assert.equal(routes.has(removed), false, `${removed} 应落入统一 404`);

    for (const current of [
      'GET /api/chat-history',
      'POST /api/agent/start',
      'GET /api/agent/status',
      'POST /api/agent/decide',
      'POST /api/agent/stop',
      'POST /api/agent/undo',
      'GET /api/model-config',
      'POST /api/model-config/profile',
      'POST /api/model-config/active',
      'POST /api/model-config/delete',
      'GET /api/settings',
      'POST /api/settings/language',
      'POST /api/settings/agent-autonomy',
      'GET /api/first-interview',
      'POST /api/first-interview/action',
      'POST /api/reset',
      'GET /api/sessions',
      'POST /api/session/open',
      'POST /api/session/archive',
    ]) assert.equal(routes.has(current), true, `${current} 仍是当前产品路径`);
  });

  it('页面只从统一 Agent 发送，首配只进入现有模型设置', () => {
    assert.doesNotMatch(html, /id=["']wizard["']|mode-wizard/);
    assert.doesNotMatch(html, /function\s+(?:enterWizard|wizPrefill|wizSaveConfig|wizCopyEnv)\b/);
    assert.doesNotMatch(html, /fetch\(['"]\/api\/(?:chat|gen-env)['"]/);

    const send = between(html, 'async function send()', '// Enter 发送');
    assert.match(send, /await startAgentTask\(/);
    assert.doesNotMatch(send, /AG\.mode|\/api\/chat/);

    assert.match(html, /id=["']btnGoWizard["']/);
    assert.match(html, /\$\('btnGoWizard'\)\.addEventListener\('click',\s*\(\)\s*=>\s*openSettings\('models'\)\)/);
    assert.match(html, /fetch\('\/api\/model-config'\)/);
    assert.match(html, /fetch\('\/api\/model-config\/profile'/);
  });

  it('首次认识只管理流程，回答仍走统一 Agent，纯对话不接受客户端扩权', () => {
    const actionRoute = between(server, "url.pathname === '/api/first-interview/action'", '// 后台整理状态');
    const agentStart = between(server, "url.pathname === '/api/agent/start'", '// 查状态');
    const send = between(html, 'async function send()', '// Enter 发送');
    const interviewAction = between(html, 'async function firstInterviewAction(action)', 'async function continueFirstInterview()');
    const conversationOnly = between(agent, 'async function converse(t: Task)', 'function taskUserMessage(t: Task)');

    assert.match(actionRoute, /!\['action', 'expectedStep'\]\.includes\(key\)/);
    assert.match(actionRoute, /Number\.isInteger\(body\.expectedStep\)/);
    assert.match(actionRoute, /activeFirstInterviewTask\(\)/);
    assert.match(actionRoute, /body\.expectedStep !== current\.step/);
    assert.doesNotMatch(actionRoute, /body\.(?:answer|content|task)/);
    assert.match(send, /startAgentTask\([\s\S]*firstInterview/);
    assert.match(send, /firstInterview && \(!FI\.modelReady \|\| FI\.modelBlocked\)/);
    assert.match(interviewAction, /if \(FI\.busy\) return/);
    assert.match(interviewAction, /JSON\.stringify\(\{ action, expectedStep \}\)/);
    assert.doesNotMatch(interviewAction, /\/api\/agent\/start|\banswer\b|\bcontent\b/);
    assert.doesNotMatch(agentStart, /body\.(?:conversationOnly|guidance|autonomy)/);
    assert.match(agentStart, /conversationOnly:\s*firstInterviewRequested/);
    assert.doesNotMatch(conversationOnly, /resolveTool|callMcp|run_command|write_file/);
  });

  it('首次认识在无模型、回复进行中和重入操作时保持原进度', () => {
    const interviewView = between(server, 'function firstInterviewView()', 'function refreshProfileAfterInterview()');
    const actionRoute = between(server, "url.pathname === '/api/first-interview/action'", '// 后台整理状态');
    const agentStart = between(server, "url.pathname === '/api/agent/start'", '// 查状态');
    const render = between(html, 'function renderFirstInterview()', 'async function loadFirstInterview()');
    const continueInterview = between(html, 'async function continueFirstInterview()', "$('firstInterviewStart').addEventListener");

    assert.match(interviewView, /const modelBlocked = !modelReady && canOffer/);
    assert.match(actionRoute, /activeFirstInterviewTask\(\)[\s\S]*409/);
    assert.match(actionRoute, /action === 'resume' && !core\.health\(\)\.llmReady/);
    assert.ok(
      agentStart.indexOf('firstInterviewRequested && !core.health().llmReady') >= 0
      && agentStart.indexOf('firstInterviewRequested && !core.health().llmReady') < agentStart.indexOf('persistAgentUserTurn'),
      '采访无模型拒绝必须发生在持久化用户消息之前',
    );
    assert.match(render, /const actionBlocked = FI\.busy \|\| sending/);
    assert.match(render, /firstInterviewSkipStep'[\s\S]*FI\.modelBlocked/);
    assert.match(render, /firstInterviewConfigure/);
    assert.match(render, /firstInterviewEnd/);
    assert.match(continueInterview, /FI\.modelBlocked \|\| !FI\.modelReady/);
    assert.match(html, /id="firstInterviewEnd"[^>]*>结束这次认识<\/button>/);
    assert.match(html, /\$\('firstInterviewEnd'\)\.addEventListener\('click', \(\) => firstInterviewAction\('skip'\)\)/);
  });

  it('破坏性重置等待任务和后台整理结束，采访记忆按轮次和步骤稳定去重', () => {
    const factoryReset = between(server, "url.pathname === '/api/factory-reset'", '// ── agent');
    const recordChat = between(server, 'recordChat: async', '// 无论是否用了工具');
    const agentStart = between(server, "url.pathname === '/api/agent/start'", '// 查状态');

    assert.ok(
      factoryReset.indexOf('activeAgentTask()') >= 0
      && factoryReset.indexOf('activeAgentTask()') < factoryReset.indexOf('core.memory.resetSubject'),
      '任务检查必须先于清空记忆',
    );
    assert.match(factoryReset, /activeTask[\s\S]*409/);
    assert.match(factoryReset, /scheduler\.status\(\)\.profileUpdating[\s\S]*409/);
    assert.ok(
      factoryReset.indexOf('scheduler.status().profileUpdating') < factoryReset.indexOf('core.memory.resetSubject'),
      '后台整理检查必须先于清空记忆',
    );
    assert.match(recordChat, /weftmate-first-interview:\$\{interview\.runId\}:\$\{interview\.step\}/);
    assert.doesNotMatch(recordChat, /interview\.conversationId/);
    assert.match(recordChat, /weftmate-agent:\$\{taskId\}/);
    assert.match(agentStart, /ensureFirstInterviewRunId\(interviewState\)[\s\S]*setFirstInterviewState\(interviewState\)/);
    assert.match(agentStart, /firstInterviewTasks\.set\([\s\S]*runId: interviewState\.runId/);
  });

  it('采访发送后只让当前采访卡进入明确的等待状态', () => {
    const render = between(html, 'function renderFirstInterview()', 'async function loadFirstInterview()');

    assert.match(render, /const interviewResponding = sending && activeHere/);
    assert.match(render, /setAttribute\('aria-busy', interviewResponding \? 'true' : 'false'\)/);
    assert.match(render, /classList\.toggle\('is-responding', interviewResponding\)/);
    assert.match(render, /firstInterviewActions'\)\.hidden = interviewResponding/);
    assert.match(render, /正在回应/);
    assert.match(render, /正在整理你的回答/);
    assert.match(html, /\.first-interview-card\.is-responding[\s\S]*@keyframes fi-interview-pulse/);
  });

  it('首次认识不暴露原始把握度，也不新增第二条消息链', () => {
    const interviewServer = between(server, 'function firstInterviewView()', 'function refreshProfileAfterInterview()');
    assert.doesNotMatch(firstInterview, /confidence|0\s*[–-]\s*1000/i);
    assert.doesNotMatch(interviewServer, /confidence|effectiveConfidence/i);
    assert.doesNotMatch(html, /fetch\(['"]\/api\/first-interview\/answer/);
    assert.equal(routeSet(server).has('POST /api/first-interview/answer'), false);
  });

  it('动态 i18n 只改文本节点和属性，不整块替换 Element 子树', () => {
    const walker = between(html, 'function i18nNode(node)', '/** 程序化取译文');
    const observer = between(html, 'const OBS_OPT', '// ══════════════════════════════════════════════════════════════════════════');

    assert.match(walker, /node\.nodeValue\s*=\s*tr/);
    assert.doesNotMatch(walker, /node\.textContent\s*=/, '整块替换会删除按钮子节点和交互结构');
    assert.match(observer, /m\.addedNodes[\s\S]*i18nNode\(m\.addedNodes\[j\]\)/);
    assert.match(observer, /i18nAttrs\(m\.target\)/);
  });
});
