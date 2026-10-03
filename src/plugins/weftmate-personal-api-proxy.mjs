/** Personal-host sole ApiProxy. Session model selection remains session-local. */
import { Service } from '@deepseek-ai/cordis'
import { ApiProxyService, createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

export class PersonalApiProxyService extends Service {
  static inject = ApiProxyService.inject
  static Config = ApiProxyService.Config

  constructor(ctx, config) {
    super(ctx, 'apiProxy')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ctx.agentDefaultModel.currentSelection(),
      cwd: process.cwd(),
      ...(config.nativeOpen === undefined ? {} : { canOpenPath: () => config.nativeOpen }),
      ...(config.sessionExportCompressionLevel === undefined ? {}
        : { sessionExportCompressionLevel: config.sessionExportCompressionLevel }),
      ...(config.coldBlankProbeMaxBytes === undefined ? {}
        : { coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes }),
    })
    for (const domain of ['sessions', 'subagents', 'workspace', 'host', 'goals', 'skills',
      'agentPresets', 'settings', 'credentials', 'llm', 'events', 'downloads']) {
      this[domain] = api[domain]
    }
    this.respond = api.respond.bind(api)
  }
}

export default PersonalApiProxyService
