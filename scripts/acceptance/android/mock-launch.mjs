// Test-only loader: observe launch environment without starting Electron.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'playwright') return { url: 'acceptance:mock-playwright', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'acceptance:mock-playwright') return { format: 'commonjs', shortCircuit: true,
      source: "exports._electron={launch:async({env})=>{require('node:fs').writeFileSync(process.env.LAUNCH_ENV_FILE,JSON.stringify({proxy:env.NODE_USE_ENV_PROXY}));throw Error('MockLaunchComplete')}};" };
    return next(url, context);
  }
});
