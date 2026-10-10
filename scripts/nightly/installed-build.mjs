import { existsSync } from 'node:fs';

// Keep the release verifier red while collecting independent synthetic app checks.
// Only the completed unpacked test build may be used; never install a rejected build.
export async function buildForSmoke(builder, options, executable, diagnostic = true) {
  try { await builder(options); return {buildPassed:true}; }
  catch (error) {
    if (!diagnostic || error.message !== 'Build step failed: scripts/verify-windows-package.mjs' || !existsSync(executable)) throw error;
    return {buildPassed:false,buildError:error.message,diagnosticUnpacked:true};
  }
}
