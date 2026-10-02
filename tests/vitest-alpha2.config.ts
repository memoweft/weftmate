import config from '../../Runtime/HarnessWorktrees/dsh-00102833-alpha2/vitest.web.config.ts'

config.test = {
  ...config.test,
  include: ['../../../Repository/tests/weftmate-alpha2-chat.e2e.ts'],
}

export default config
