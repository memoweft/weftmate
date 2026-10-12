/* Account-scoped connector actions; presentation lives in connector-view.js. */
globalThis.WeftUiCore.factories.connectors = core => {
  let writes = Promise.resolve();
  function changeConnector(operation) {
    const identity = core.state.identityGeneration;
    const work = writes.catch(() => {}).then(() => {
      if (identity !== core.state.identityGeneration) throw new Error('ACCOUNT_CHANGED');
      return core.accessApi('/settings/approvals', { method: 'PATCH', protectedWrite: true, body: { connector: operation }, timeoutMs: 15000 });
    }); writes = work; return work;
  }
  return { readConnectors: () => core.accessApi('/settings/approvals'), changeConnector };
};
