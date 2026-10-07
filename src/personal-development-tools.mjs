/** Load development fixtures only when their existing explicit switches are set. */
export async function loadPersonalDevelopmentTools(env = process.env) {
  const tools = {
    syntheticStopFixtureRoute: () => null,
    syntheticBrowserFixtureSettings: () => ({}),
  };
  if (env.WEFTMATE_SYNTHETIC_STOP_FIXTURE === '1') {
    tools.syntheticStopFixtureRoute = (await import('./synthetic-stop-fixture-policy.mjs')).syntheticStopFixtureRoute;
  }
  if (env.WEFTMATE_SYNTHETIC_BROWSER_PORT !== undefined) {
    tools.syntheticBrowserFixtureSettings = (await import('./synthetic-browser-fixture-policy.mjs')).syntheticBrowserFixtureSettings;
  }
  if (env.WEFTMATE_STAGE14_R2_OBSERVE === '1') {
    const [record, proxy, policy] = await Promise.all([
      import('./personal-model-observation/record.mjs'),
      import('./personal-model-observation/proxy.mjs'),
      import('./personal-model-observation/policy.mjs'),
    ]);
    tools.createObservationRecorder = record.createObservationRecorder;
    tools.createPersonalModelObservationProxy = proxy.createPersonalModelObservationProxy;
    tools.stage14R2ObservationProfile = policy.stage14R2ObservationProfile;
  }
  return tools;
}
