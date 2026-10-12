import { createServer, connect } from 'node:net';
import { randomUUID } from 'node:crypto';

export const QUIT_TIMEOUT_MS = 20_000;
export const QUIT_TIMEOUT_EXIT = 3;
const prefix = '\\\\.\\pipe\\weftmate-quit-';

/** The requesting instance waits for the existing shutdown's durable exit record. */
export async function requestDesktopQuit(app, { timeoutMs = QUIT_TIMEOUT_MS } = {}) {
  const pipe = prefix + randomUUID();
  let socket, timer;
  const server = createServer();
  try {
    await new Promise((ok, no) => { server.once('error', no); server.listen(pipe, ok); });
    const reply = new Promise(resolve => {
      timer = setTimeout(() => resolve(QUIT_TIMEOUT_EXIT), timeoutMs);
      server.on('connection', connection => {
        socket = connection;
        connection.setEncoding('utf8');
        let text = '';
        connection.on('data', chunk => { text += chunk; });
        connection.on('end', () => resolve(text === '0' ? 0 : 4));
        connection.on('error', () => resolve(4));
      });
    });
    if (app.requestSingleInstanceLock({ weftmateQuitPipe: pipe })) {
      app.releaseSingleInstanceLock();
      return 0;
    }
    return await reply;
  } catch { return 4; }
  finally { clearTimeout(timer); socket?.destroy(); await new Promise(resolve => server.close(resolve)); }
}

export function desktopQuitReply(data) {
  const pipe = data?.weftmateQuitPipe;
  if (typeof pipe !== 'string' || !/^\\\\\.\\pipe\\weftmate-quit-[0-9a-f-]{36}$/.test(pipe)) return null;
  return code => new Promise(resolve => {
    const socket = connect(pipe);
    const timer = setTimeout(() => { socket.destroy(); resolve(); }, 1000);
    socket.on('connect', () => socket.end(String(code)));
    socket.on('error', () => { clearTimeout(timer); resolve(); });
    socket.on('close', () => { clearTimeout(timer); resolve(); });
  });
}
