import pty from 'node-pty';

// Native terminal handles and ConPTY drain threads belong to this short-lived
// process, so an exited shell cannot leave native handles in Electron main.
let terminal;
const send = (event, callback) => process.connected ? process.send(event, callback) : callback?.();
process.on('message', message => {
  try {
    if (message.type === 'start') {
      terminal = pty.spawn(message.shell.file, message.shell.args, { name: 'xterm-256color',
        cwd: message.cwd, cols: message.cols, rows: message.rows, env: message.env,
        useConpty: true, useConptyDll: true });
      terminal.onData(data => send({ type: 'output', data }));
      terminal.onExit(({ exitCode }) => send({ type: 'exit', exitCode }, () => process.exit(0)));
      send({ type: 'started', pid: terminal.pid });
    } else if (message.type === 'input') terminal.write(message.data);
    else if (message.type === 'resize') terminal.resize(message.cols, message.rows);
  } catch {
    send({ type: 'failed' }, () => process.exit(1));
  }
});
process.on('disconnect', () => { terminal?.kill(); process.exit(0); });
