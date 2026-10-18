// A real live child; readiness avoids using startup sleeps in cleanup tests.
process.send('ready');
setInterval(() => {}, 1000);
