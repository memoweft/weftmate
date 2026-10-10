/** Account-scoped views of existing tasks and native goals. */
import { exactKeys, failure } from './common.mjs';
import { REQUEST_ID } from './constants.mjs';
import { hasPrivateContent } from './temporary-chats.mjs';
import { activitySource } from './activity-store.mjs';

export function createGoalOperations(context) {
  function owned(ownerId, sessionId) {
    const account = context.accountState(ownerId), session = account.sessions[sessionId];
    if (!session || session.deleting || session.origin !== 'personal-remote') throw failure('SESSION_UNAVAILABLE', 404);
    if (account.memoryCleanupPending) throw failure('SESSION_BUSY', 409);
    return session;
  }
  async function overview(ownerId) {
    const account = context.accountState(ownerId), generation = account.activity?.generation ?? 0, items = [], recent = [], since = context.timestamp() - 7 * 86400000, names = new Map();
    if (account.memoryCleanupPending) return { items, recent, timeZone: context.usage.settings(ownerId).timeZone };
    for (const command of Object.values(account.commands)) {
      const session = account.sessions[command.sessionId];
      if (command.kind !== 'session.message' || command.rootTaskId || !session || session.origin !== 'personal-remote' || session.deleting) continue;
      if (command.createdAt <= (account.activity?.erasedBefore?.[command.sessionId] ?? '')) continue;
      const terminal = Object.values(account.activity?.items ?? {}).find(row => row.source.taskId === command.commandId && row.type.startsWith('task.'));
      if (terminal && Date.parse(terminal.at) < since) continue;
      const task = await context.taskDetail(account, command.commandId), e = task.replyEvidence, jobs = task.control.backgroundJobs;
      const pending = (command.toolApprovals ?? []).some(row => row.status === 'pending');
      const question = (command.userQuestions ?? []).some(row => row.status === 'pending');
      const unfinishedSteps = task.executionSteps?.some(row => ['running','uncertain'].includes(row.state));
      const ended = !!(terminal || ['completed','failed','aborted'].includes(e.status)) && !jobs.active && !jobs.unconfirmed && !unfinishedSteps && task.control.state !== 'uncertain';
      const status = task.control.state === 'stop_requested' ? task.control.stopStatus === 'stopped' ? 'stopped' : task.control.stopStatus === 'completed' ? 'completed' : 'stopping'
        : pending ? 'approval' : question ? 'question' : command.state === 'rejected' ? 'failed' : task.control.state === 'uncertain' || jobs.unconfirmed || e.status === 'unconfirmed' && command.state === 'accepted_by_dsh' ? 'unconfirmed'
        : ended ? terminal?.type.slice(5) ?? (e.status === 'aborted' ? 'stopped' : e.status)
        : ['pending','dispatching'].includes(command.state) || e.status === 'waiting' && e.turn === null ? 'queued' : 'running';
      const privateSource = hasPrivateContent(session), source = activitySource(account, command.sessionId, { taskId: command.commandId }), chat = account.chatIdentity?.chats[source.chatId];
      if (!privateSource && !session.title && !names.has(command.sessionId) && context.backend?.describeSession) names.set(command.sessionId, (await context.backend.describeSession(command.sessionId,ownerId))?.title);
      const finishedAt = ['completed','failed','stopped'].includes(status) ? terminal?.at ?? e.terminalAt ?? (status === 'stopped' ? task.control.stopObservedAt : null) ?? command.updatedAt : null;
      const step = task.executionSteps?.findLast(row => row.state === 'running');
      const verbs = { read:'正在读取文件',write:'正在保存文件',edit:'正在修改文件',glob:'正在查找文件',grep:'正在检索内容',pwsh:'正在运行命令',bash:'正在运行命令',web_fetch:'正在查看网页',subagent:'正在处理子任务',schedule_create:'正在安排定时任务',schedule_manage:'正在管理定时任务',create_goal:'正在建立目标',update_goal:'正在更新目标' };
      const row = { taskId: command.commandId, source, title: privateSource ? '临时对话中的任务' : String(command.taskLabel ?? command.payload.text ?? '正在处理的任务').slice(0,80),
        conversationTitle: privateSource ? '临时对话' : chat?.kind === 'main' ? 'WeftMate 主对话' : session.title ?? names.get(command.sessionId) ?? '旁聊', status, createdAt: command.createdAt,
        startedAt: e.startedAt ?? e.firstChunkAt ?? null, finishedAt,
        elapsedSeconds: Math.max(0, Math.floor(((finishedAt ? Date.parse(finishedAt) : context.timestamp()) - Date.parse(e.startedAt ?? e.firstChunkAt ?? command.createdAt)) / 1000)),
        step: privateSource ? '打开临时对话查看进展。' : ended ? '打开对话查看结果' : jobs.active ? `${jobs.active} 项后台工作正在执行` : pending ? '等待你批准操作' : question ? '等待你补充信息' : step ? verbs[step.toolName] ?? '正在处理一个步骤' : e.step ? `正在处理第 ${e.step} 步` : status === 'queued' ? '等待开始' : '正在生成回复',
        canStop: task.control.canStop && !ended && command.state !== 'rejected' };
      if (['completed','failed','stopped'].includes(status)) { if (finishedAt && Date.parse(finishedAt) >= since) recent.push(row); } else items.push(row);
    }
    const live = context.accountState(ownerId);
    if (live.memoryCleanupPending || (live.activity?.generation ?? 0) !== generation) throw failure('CURSOR_RESET_REQUIRED',409);
    const retained = row => live.sessions[row.source.sessionId] && !live.sessions[row.source.sessionId].deleting;
    return { items: items.filter(retained).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), recent: recent.filter(retained).sort((a,b) => b.finishedAt.localeCompare(a.finishedAt)), timeZone: context.usage.settings(ownerId).timeZone };
  }
  async function handleHttp(request,response,url,ownerId) {
    if (url.pathname === '/personal/v1/tasks' && request.method === 'GET') { context.authenticate(request,'sessions:read'); if (url.search) throw failure('INVALID_REQUEST'); context.json(response,200,await overview(ownerId)); return true; }
    const match = /^\/personal\/v1\/goals(?:\/([A-Za-z0-9_-]+)\/(complete|archive))?$/.exec(url.pathname);
    if (!match) return false;
    const write = request.method !== 'GET'; context.authenticate(request,write ? 'commands:write' : 'sessions:read');
    if (url.search) throw failure('INVALID_REQUEST');
    if (!context.backend.goals) throw failure('CAPABILITY_UNAVAILABLE',503);
    if (!write && !match[1]) {
      const generation = context.accountState(ownerId).activity?.generation ?? 0, items = [];
      for (const [sessionId,session] of Object.entries(context.accountState(ownerId).sessions)) {
        if (session.origin !== 'personal-remote' || session.deleting) continue;
        const { goal } = await context.backend.goals({ownerId,sessionId,action:'list'}), account = context.accountState(ownerId);
        if (!goal || !account.sessions[sessionId] || account.memoryCleanupPending) continue;
        const privateSource = hasPrivateContent(account.sessions[sessionId]);
        const schedules = context.backend.schedules ? (await context.backend.schedules({ownerId,sessionId,action:'list'})).items : [];
        items.push({...goal,temporary:privateSource,objective:privateSource ? '临时对话中的目标' : goal.objective,title:privateSource ? '临时对话中的目标' : goal.objective.split('\n')[0],
          description:privateSource ? '' : goal.objective.split('\n').slice(1).join('\n'),source:activitySource(account,sessionId),
          conversationTitle:privateSource ? '临时对话' : session.title ?? (await context.backend.describeSession?.(sessionId,ownerId))?.title ?? '旁聊',scheduleIds:schedules.map(row=>row.id),
          progress:privateSource ? '打开临时对话查看。' : goal.blockedReason?.message ?? `已执行 ${goal.roundsStarted} 轮`,...(privateSource ? {blockedReason:undefined} : {})});
      }
      if ((context.accountState(ownerId).activity?.generation ?? 0) !== generation) throw failure('CURSOR_RESET_REQUIRED',409);
      context.json(response,200,{items}); return true;
    }
    if (request.method !== 'POST' || !context.hostOwner(ownerId)) throw failure('FORBIDDEN',403);
    const body = await context.readJson(request);
    exactKeys(body,match[1] ? ['requestId','ref'] : ['requestId','sessionId','title','description'],match[1] ? ['requestId','ref'] : ['requestId','sessionId','title']);
    if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw failure('INVALID_REQUEST');
    const sessionId = match[1] ?? body.sessionId; owned(ownerId,sessionId);
    if (match[1]) { exactKeys(body.ref,['id','revision'],['id','revision']); if (typeof body.ref.id !== 'string' || !Number.isSafeInteger(body.ref.revision) || body.ref.revision < 1) throw failure('INVALID_REQUEST'); }
    else if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 160 || body.title.includes('\n') || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 32000)) throw failure('INVALID_REQUEST');
    const result = await context.backend.goals({ownerId,sessionId,action:match[2] ?? 'create',requestId:body.requestId,...(match[1] ? {ref:body.ref} : {objective:[body.title.trim(),body.description?.trim()].filter(Boolean).join('\n')})});
    context.json(response,match[1] ? 200 : 201,result); return true;
  }
  return {handleHttp,overview};
}
