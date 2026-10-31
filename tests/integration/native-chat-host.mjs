// Isolated synthetic host for native Android chat acceptance: no real model, no daily data.
// Usage: node tests/integration/native-chat-host.mjs <info.json>  — writes origin and credentials, then stays up until killed.
import { writeFileSync } from 'node:fs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: native-chat-host.mjs <info.json>');
const host = await startTimelineCandidate({ daily: true, inlineProgress: true, historyCount: 0 });
writeFileSync(out, JSON.stringify({ origin: host.origin, port: Number(new URL(host.origin).port), sessionId: host.sessionId,
  username: host.credentials.username, password: host.credentials.password }, null, 2));
console.log('NATIVE_CHAT_HOST_READY', host.origin);
const stop = async () => { await host.close?.(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
