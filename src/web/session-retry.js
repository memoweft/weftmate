/** Retry input is scoped to the selected session, never the previous tab. */
export function retryPromptForSession(lastPromptBySession, messages, sessionId) {
  return lastPromptBySession.get(sessionId)
    || [...(messages.get(sessionId) ?? [])].reverse().find((item) => item.kind === 'user')?.text
    || '';
}
