export { WORK_SWITCH_REASON } from '../plugins/personal-work-mode.mjs';
export const isWorkSwitch = value => value?.intent === 'work-switch' || value?.reason?.startsWith('[weftmate:work-switch]');
export const conversationMode = session => session?.phoneHistory ? 'chat' : session?.mode ?? (session?.projectId || session?.workspaceKind === 'browser' ? 'work' : 'chat');
export const executionProject = command => command?.workContext ?? command?.payload ?? {};

const handoffIndexes = new WeakMap();
export function workHandoffs(account, sessionId) {
  if (!account.commands || !sessionId) return [];
  let index = handoffIndexes.get(account.commands);
  if (!index || index.sessions !== account.sessions || index.identity !== account.chatIdentity) {
    const rows = new Map();
    const activeSession = id => {
      const identity=account.chatIdentity, segment=identity?.segments?.[identity.sessionSegments?.[id]];
      return identity?.segments?.[identity.chats?.[segment?.chatId]?.activeSegmentId]?.sessionId || id;
    };
    for (const source of Object.values(account.commands)) for (const row of source.toolApprovals ?? []) {
      if (!isWorkSwitch(row) || row.decisionOutcome !== 'allowed-once' || !row.workSessionId || !account.sessions[row.sessionId]) continue;
      const create = account.commands[row.workCreateCommandId], message = account.commands[row.workCommandId];
      const command = message || create;
      const stage = command?.state === 'uncertain' ? 'uncertain'
        : command && !['pending','preflight','dispatching','accepted_by_dsh'].includes(command.state) ? 'failed'
        : message?.state === 'accepted_by_dsh' ? 'ready' : message ? 'sending'
        : create?.state === 'accepted_by_dsh' ? 'context' : 'creating';
      const sourceActiveSessionId=activeSession(row.sessionId), workActiveSessionId=activeSession(row.workSessionId);
      const value = { approvalId:row.approvalId, sourceSessionId:row.sessionId, workSessionId:row.workSessionId, sourceActiveSessionId, workActiveSessionId,
        workProjectId:row.workProjectId, decisionRequestId:row.decisionRequestId, stage,
        workExists:!!account.sessions[workActiveSessionId], at:row.answeredAt || row.createdAt };
      const destinations=new Map([[row.sessionId,'outgoing'],[sourceActiveSessionId,'outgoing'],[row.workSessionId,'incoming'],[workActiveSessionId,'incoming']]);
      for (const [id,direction] of destinations) {
        if (!account.sessions[id]) continue;
        if (!rows.has(id)) rows.set(id,[]);
        rows.get(id).push({...value,direction});
      }
    }
    for (const values of rows.values()) values.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    index = {sessions:account.sessions,identity:account.chatIdentity,rows}; handoffIndexes.set(account.commands,index);
  }
  return index.rows.get(sessionId) || [];
}

export function modeProjection(session, account, sessionId) {
  const mode = conversationMode(session), project = account.projects?.[session?.projectId];
  const handoffs = workHandoffs(account, sessionId);
  return { mode, ...(handoffs.length ? {workHandoffs:handoffs} : {}), ...(mode === 'work' ? { workHostId: session?.workHostId ?? account.hostId,
    workDirectory: project && !project.revoked ? { projectId: project.projectId, name: project.name, pathHint: project.pathHint ?? '' } : null } : {}) };
}
