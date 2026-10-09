/** A saved schedule is account intent, independent of its creating login's TTL. */
export function scheduledCommandSource(account, command) {
  const source = account.commands[command?.scheduleSourceId];
  const logical = command?.payload?.chatId && source?.payload?.chatId === command.payload.chatId;
  return typeof command?.scheduleSourceId === 'string' && /^scheduled-[a-f0-9]{48}$/.test(command.requestId ?? '') &&
    ['session.message','chat.message'].includes(command.kind) && command.payload?.mode === 'queue' &&
    source?.kind === 'session.message' && source.state === 'accepted_by_dsh' && !source.scheduleSourceId &&
    (source.sessionId === command.sessionId || logical) && source.sourceDeviceId === command.sourceDeviceId &&
    command.ownerId === account.ownerId && source.ownerId === account.ownerId;
}
