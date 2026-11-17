/** Personal-host sole ApiProxy. Session model selection remains session-local. */
import { Service } from '@deepseek-ai/cordis'
import { AsyncLocalStorage } from 'node:async_hooks'

const { ApiProxyService, createApiProxy } = await import('@deepseek-ai/dsh-host-apiproxy').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes("Cannot find package '@deepseek-ai/dsh-host-apiproxy'")) throw error
  return {}
})

function apply(ctx) {
  const selections = new AsyncLocalStorage()
  const defaults = ctx.agentDefaultModel
  const controller = ctx.sessionController
  const save = defaults.saveSelection
  const select = controller.selectModel
  const saveSelection = function (...args) {
    return selections.getStore() ? Promise.resolve() : save.apply(this, args)
  }
  const selectModel = function (request) {
    return selections.run(true, () => select.call(this, request))
  }
  defaults.saveSelection = saveSelection
  controller.selectModel = selectModel
  ctx.effect(() => () => {
    if (defaults.saveSelection === saveSelection) defaults.saveSelection = save
    if (controller.selectModel === selectModel) controller.selectModel = select
  }, 'weftmate session-local model selection')
}

export class PersonalApiProxyService extends Service {
  static inject = ApiProxyService?.inject ?? ['agentDefaultModel', 'sessionController']
  static Config = ApiProxyService?.Config

  constructor(ctx, config) {
    super(ctx, createApiProxy ? 'apiProxy' : 'weftmatePersonalApiProxy')
    if (!createApiProxy) { apply(ctx); return }
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
