/**
 * Pure main-window trust fence. The DSH server chooses a new loopback port
 * after a restart, so host-only or `127.0.0.1` checks are insufficient: trust
 * is one exact origin, one Electron webContents, and its main frame.
 */
export function isExactRuntimeOrigin(value: unknown, expectedOrigin: string | null | undefined): boolean {
  if (typeof value !== 'string' || typeof expectedOrigin !== 'string') return false;
  try {
    const actual = new URL(value);
    const expected = new URL(expectedOrigin);
    return actual.protocol === 'http:'
      && actual.hostname === '127.0.0.1'
      && actual.origin === expected.origin
      && expected.protocol === 'http:'
      && expected.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Any top-level navigation outside the current exact runtime origin is denied. */
export function blocksUnexpectedRendererNavigation(targetUrl: unknown, expectedOrigin: string | null | undefined): boolean {
  return !isExactRuntimeOrigin(targetUrl, expectedOrigin);
}

export function isTrustedRendererInvocation(input: {
  expectedOrigin: string | null | undefined;
  sender: unknown;
  expectedSender: unknown;
  senderFrame: { url?: unknown } | null | undefined;
  mainFrame: unknown;
}): boolean {
  return input.sender === input.expectedSender
    && input.senderFrame === input.mainFrame
    && isExactRuntimeOrigin(input.senderFrame?.url, input.expectedOrigin);
}
