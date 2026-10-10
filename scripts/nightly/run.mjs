// NIGHTLY_HANDOFF_V1: stable bootstrap protocol.
import { bootstrap } from './bootstrap.mjs';
if (process.argv.includes('--nightly-engine')) await import('./engine.mjs');
else process.exitCode = await bootstrap(process.argv.slice(2));
