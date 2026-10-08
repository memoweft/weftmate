/** A saved schedule is account intent, independent of its creating login's TTL. */
export function scheduledCommandSource(account, command) {
  const source = account.commands[command?.scheduleSourceId];
  return typeof command?.scheduleSourceId === 'string' && /^scheduled-[a-f0-9]{48}$/.test(command.requestId ?? '') &&
    command.kind === 'session.message' && command.payload?.mode === 'queue' &&
    source?.kind === 'session.message' && source.state === 'accepted_by_dsh' && !source.scheduleSourceId &&
    source.sessionId === command.sessionId && source.sourceDeviceId === command.sourceDeviceId &&
    command.ownerId === account.ownerId && source.ownerId === account.ownerId;
}
