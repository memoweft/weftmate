/**
 * R2 契约测试：weftmate profile 组合基线（官方 web 全集 + 安全基线）。
 *
 * 锁定「weftmate profile = dsh-base + dsh-web-app 两层官方 bundle patch + 空补丁层」
 * 组装出来的组合面事实（--dump-default-config，不经 boot、不跑 LLM）：
 *   - 沙箱安全基线：sandbox-policy workspace-write 默认 + workspaceRoot = 子进程 cwd；
 *   - 审批基线：ask（danger-full-access → never）；
 *   - 权限预设三档（read-only / workspace-write / danger-full-access）；
 *   - web 宿主行（webserver / web-runtime / modules / connection / apiproxy 等）；
 *   - 官方客户端插件清单（32 个 dsh.client 行抽查）；
 *   - agent-presets 行（shipped standard preset 挂载面）。
 *
 * 运行时来源：WEFTMATE_DSH_RUNTIME → vendored CLI；否则 checkout CLI（与契约测试同源纪律）。
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { isolatedEnv, loadPin, resolveRuntimeRoot } from './support/checkout.ts'
import { DshWebRuntime, writeWebProfile } from '../../src/dsh-web-runtime.ts'

/**
 * 子进程跑 vendored/checkout CLI 的 --dump-config（defaultOnly 控制是否含 profile 补丁层），收集输出。
 * 超时不会抢先 resolve：Windows 先对本次记录的根 PID 执行 taskkill /PID <pid> /T /F
 * （参数数组、无 shell），防止单杀 root 后 descendant 持有 pipe；POSIX 先 TERM、5 秒后 KILL。
 * 最终仍由 close 事件结算。
 */
function runDump(bin: string, home: string, defaultOnly: boolean, timeoutMs: number, patchFiles: readonly string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, '--profile', 'weftmate', ...patchFiles.flatMap((file) => ['--patch', file]), defaultOnly ? '--dump-default-config' : '--dump-config'], {
      cwd: home,
      env: isolatedEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timeoutTimer: NodeJS.Timeout | undefined
    let hardKillTimer: NodeJS.Timeout | undefined
    let taskkillCallbackSeen = false
    const rootPid = child.pid

    const finish = (result: { code: number | null; stdout: string; stderr: string }): void => {
      if (settled) return
      settled = true
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      if (hardKillTimer !== undefined) clearTimeout(hardKillTimer)
      resolve(result)
    }

    const hardKillPosix = (): void => {
      try {
        child.kill('SIGKILL')
      } catch {
        // close/error 监听保留原始诊断。
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    timeoutTimer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && rootPid !== undefined && rootPid > 0) {
        // 先收根树；若先 child.kill，继承 pipe 的 descendant 可使 close 永久等待。
        execFile('taskkill', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true }, (error) => {
          taskkillCallbackSeen = true
          if (error !== null && !settled) {
            try { child.kill() } catch { /* close/error 监听保留诊断 */ }
          }
        })
      } else {
        try {
          child.kill()
        } catch {
          // watchdog 仍会接管；不能在此提前 resolve。
        }
      }
      hardKillTimer = setTimeout(() => {
        if (settled) return
        if (process.platform === 'win32') {
          if (!taskkillCallbackSeen) {
            try { child.kill() } catch { /* close/error 监听保留诊断 */ }
          }
          return
        }
        hardKillPosix()
      }, 5_000)
    }, timeoutMs)
    child.on('error', (error) => {
      if (!timedOut) finish({ code: null, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      finish(timedOut
        ? { code: null, stdout, stderr: `${stderr}\n[dump timed out]` }
        : { code, stdout, stderr })
    })
  })
}

describe('weftmate web profile 组合基线（R2-02 安全基线 + G-01 官方全集）', () => {
  test('--dump-default-config：沙箱/审批/权限预设/官方宿主与客户端清单全挂', { timeout: 180_000 }, async () => {
    const pin = await loadPin()
    const root = await resolveRuntimeRoot(pin)
    const vendor = root.includes('dsh-runtime')
    const bin = vendor
      ? join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      : join(root, 'apps', 'cli', 'lib', 'bin.js')
    const home = await mkdtemp(join(tmpdir(), 'weftmate-web-profile-contract-'))
    try {
      assert.equal(await writeWebProfile(home, 'weftmate'), 'created')
      const { code, stdout, stderr } = await runDump(bin, home, true, 150_000)
      assert.equal(code, 0, `dump 失败（exit ${code}）：\n${stderr.slice(-2000)}`)

      // 沙箱安全基线（REQUIREMENTS R2-02）：workspace-write 默认 + workspaceRoot = 子进程 cwd。
      assert.match(stdout, /- id: sandbox-policy/)
      assert.match(stdout, /mode: !!js process\.env\.DSH_PERMISSION_MODE \?\? 'workspace-write'/)
      assert.match(stdout, /workspaceRoot: !!js process\.cwd\(\)/)
      // 审批 ask 基线（danger-full-access → never）。
      assert.match(stdout, /- id: approval/)
      assert.match(stdout, /'danger-full-access' \? 'never' : 'ask'/)
      // 权限预设三档。
      assert.match(stdout, /- id: permission/)
      assert.match(stdout, /read-only:\s*\n\s*sandbox: read-only\s*\n\s*approval: ask/)
      assert.match(stdout, /workspace-write:\s*\n\s*sandbox: workspace-write\s*\n\s*approval: ask/)
      assert.match(stdout, /danger-full-access:\s*\n\s*sandbox: danger-full-access\s*\n\s*approval: never/)
      assert.match(stdout, /- id: ui-permission/)

      // 官方 web 宿主行。
      for (const row of ['webserver', 'web-runtime', 'modules', 'connection', 'api-gateway', 'storage', 'storage-json', 'storage-domain', 'workspace', 'agent-presets']) {
        assert.ok(stdout.includes(`- id: ${row}`), `缺宿主行 ${row}`)
      }
      // 官方客户端插件清单抽查（32 个 dsh.client 行）。
      for (const row of ['ui-theme', 'locale', 'ui-layout', 'ui-sidebar', 'ui-conversation', 'ui-tool', 'ui-trajectory', 'ui-skill', 'ui-subagent', 'ui-goal', 'ui-plan', 'ui-jobs', 'ui-workflow-run', 'ui-deliverables', 'ui-workspace', 'ui-input-trigger', 'ui-commands', 'ui-model-selection', 'ui-permission', 'ui-settings', 'ui-settings-general', 'ui-settings-models', 'ui-user-questions', 'ui-message-feedback', 'ui-agent-preset', 'ui-cordis']) {
        assert.ok(stdout.includes(`- id: ${row}`), `缺客户端行 ${row}`)
      }
      // 凭据/设置/会话官方行。
      for (const row of ['credentials', 'settings', 'session-persistence-jsonl', 'llm-deepseek', 'llm-pi-ai', 'session-telemetry-otel']) {
        assert.ok(stdout.includes(`- id: ${row}`), `缺核心行 ${row}`)
      }
      // Windows 平台门：bash 关、pwsh 开（官方语义；dump 在 Windows 上生成）。
      assert.match(stdout, /- id: bash-sandbox\s*\n\s*name: '@deepseek-ai\/dsh-bash-sandbox'\s*\n\s*disabled: !!js process\.platform === 'win32'/)
      assert.match(stdout, /- id: pwsh-sandbox\s*\n\s*name: '@deepseek-ai\/dsh-pwsh-sandbox'\s*\n\s*disabled: !!js process\.platform !== 'win32'/)

      // R3-03 扩展点：含 profile 补丁层的组合树挂 weftmate 自有行（宿主行 + 客户端 dsh.client 行）。
      const withLayer = await runDump(bin, home, false, 150_000)
      assert.equal(withLayer.code, 0, `dump（含补丁层）失败（exit ${withLayer.code}）：\n${withLayer.stderr.slice(-2000)}`)
      assert.match(withLayer.stdout, /- id: weftmate-host\s*\n\s*name: \.\/plugins\/weftmate-host\.mjs/)
      assert.match(withLayer.stdout, /- id: weftmate-aigame-host\s*\n\s*name: \.\/plugins\/weftmate-aigame-host\.mjs/)
      // R9 profile template does not own credentials. The final host-owned
      // --patch is tested below, so an owner patch cannot omit the safe bridge.
      assert.doesNotMatch(withLayer.stdout, /name: \.\/plugins\/weftmate-credentials\.mjs/)
      assert.match(withLayer.stdout, /- id: '@weftmate\/client'\s*\n\s*name: '@weftmate\/client'/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('final security overlay supplies exactly one safe credential provider even when owner patch omits it', { timeout: 180_000 }, async () => {
    const pin = await loadPin()
    const root = await resolveRuntimeRoot(pin)
    const bin = root.includes('dsh-runtime')
      ? join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      : join(root, 'apps', 'cli', 'lib', 'bin.js')
    const home = await mkdtemp(join(tmpdir(), 'weftmate-final-security-overlay-'))
    try {
      await writeWebProfile(home, 'weftmate')
      // This represents a preserved owner patch which deliberately lacks any
      // WeftMate credential provider. The final host --patch must still add it.
      await writeFile(join(home, 'profiles', 'weftmate', 'cordis.patch.yml'), '# owner patch without credentials\n[]\n', 'utf8')
      const securityPatch = join(home, 'weftmate-security-credentials.patch.yml')
      await writeFile(securityPatch, [
        '- id: credentials', '  disabled: true',
        '- id: weftmate-credentials', '  disabled: true',
        '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
      ].join('\n'), 'utf8')
      const dumped = await runDump(bin, home, false, 150_000, [securityPatch])
      assert.equal(dumped.code, 0, `final security dump failed:\n${dumped.stderr.slice(-2000)}`)
      assert.match(dumped.stdout, /- id: credentials\s*\n\s*name: '@deepseek-ai\/dsh-credentials-local'\s*\n\s*disabled: true/)
      assert.match(dumped.stdout, /- id: weftmate-safe-credentials\s*\n\s*name: \.\/plugins\/weftmate-credentials\.mjs/)
      assert.equal((dumped.stdout.match(/name: \.\/plugins\/weftmate-credentials\.mjs/g) ?? []).length, 1)
      assert.match(dumped.stdout, /- id: ui-settings-models\s*\n\s*name: '@deepseek-ai\/dsh-client-ui-settings-models'/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('secure bridge rejects an owner isolated credentials alias before web boot', { timeout: 180_000 }, async () => {
    const pin = await loadPin()
    const root = await resolveRuntimeRoot(pin)
    const home = await mkdtemp(join(tmpdir(), 'weftmate-isolated-credential-alias-'))
    try {
      await writeWebProfile(home, 'weftmate')
      // An aliased provider plus isolate.credentials could evade Cordis' normal
      // service collision. Preflight must reject its composed dump before CLI
      // web boot, even though the final overlay inserts the reserved provider.
      await writeFile(join(home, 'profiles', 'weftmate', 'cordis.patch.yml'), [
        '- insert:',
        '    - id: owner-credentials-alias',
        "      name: '@deepseek-ai/dsh-credentials-local'",
        '      isolate:',
        '        credentials: owner-private-realm',
        '',
      ].join('\n'), 'utf8')
      const securityPatch = join(home, 'weftmate-security-credentials.patch.yml')
      await writeFile(securityPatch, [
        '- id: credentials', '  disabled: true',
        '- id: weftmate-credentials', '  disabled: true',
        '- insert:', '    - id: weftmate-safe-credentials', '      name: ./plugins/weftmate-credentials.mjs', '',
      ].join('\n'), 'utf8')
      const runtime = new DshWebRuntime({
        runtimePath: root.includes('dsh-runtime') ? root : undefined,
        checkoutPath: root.includes('dsh-runtime') ? undefined : root,
        homeDir: home,
        workspaceDir: home,
        patchFiles: [securityPatch],
        credentialRequestHandler: async () => ({}),
        readyTimeoutMs: 5_000,
      })
      await assert.rejects(runtime.start(), /安全凭据配置预检拒绝/)
      assert.equal(runtime.isRunning(), false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('main 壳接线：工作区默认值 / 凭据接缝 / Electron 启动旗标（R2-02 / R1-04）', () => {
    const main = readFileSync(new URL('../../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    // 工作区默认值 = userData/workspace（REQUIREMENTS R2-02 口径；子进程 cwd → sandbox workspaceRoot）。
    assert.match(main, /const workspaceDir = join\(app\.getPath\('userData'\), 'workspace'\)/)
    // 凭据接缝：safeStorage 只经受管 child IPC 请求按 ref 解析；不能再随
    // 子进程环境注入。旧 private route 的 key 在首次 resolve 时迁移到官方 ref。
    assert.match(main, /credentialRequestHandler,/)
    assert.match(main, /migrateLegacyCredentialRef\(ref\)/)
    assert.doesNotMatch(main, /credentialEnvironment\(profiles/)
    assert.doesNotMatch(main, /writeFileSync\([^)]*DEEPSEEK_API_KEY|credentials\.yaml/, 'key 不得由 main 落盘')
    // Electron 形态 spawn 官方 CLI 的旗标（dsh-web-runtime 内 --expose-internals 兜底通道）。
    const runtime = readFileSync(new URL('../../src/dsh-web-runtime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(runtime, /const nodeArgs = this\.opts\.nodeElectron \? \['--expose-internals'\] : \[\]/)
    assert.match(runtime, /env\.DSH_TELEMETRY_DISABLED = '1'/)
    assert.match(runtime, /env\.ELECTRON_RUN_AS_NODE = '1'/)
    // R8：凭据不再进 child env；开启安全 handler 时是专用 Node IPC fd（不是 localhost）。
    assert.match(runtime, /credentialRequestHandler\?: WeftMateCredentialRequestHandler/)
    assert.match(runtime, /stdio: this\.opts\.credentialRequestHandler === undefined \? \['ignore', 'pipe', 'pipe'\] : \['ignore', 'pipe', 'pipe', 'ipc'\]/)
    assert.match(runtime, /PROFILE_PATCH_TEMPLATE_R8/)
    const templateStart = runtime.indexOf('export const PROFILE_PATCH_TEMPLATE =')
    const templateEnd = runtime.indexOf('/** R3 旧补丁层模板', templateStart)
    assert.doesNotMatch(runtime.slice(templateStart, templateEnd), /weftmate-credentials\.mjs/)
    // R3 真机修复：目录选择器钉 browse（auto 的 win32 native dialog worker 在 Electron 下不可用）。
    assert.match(runtime, /- id: directory-picker\s*\n\s*disabled: true/)
    assert.match(runtime, /@deepseek-ai\/dsh-host-directory-picker-browse/)
    assert.match(runtime, /@deepseek-ai\/dsh-client-ui-directory-picker-browse/)
  })

  test('R3 壳接线：状态/动作双工接缝 + 品牌环境注入（R3-02）', () => {
    const main = readFileSync(new URL('../../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    // main 侧状态文件写者（托盘常驻/数据目录/更新态）与请求文件消费者（check/install → electron-updater）。
    assert.match(main, /weftmate-host-state\.json/)
    assert.match(main, /weftmate-update-request\.json/)
    assert.match(main, /tray: \{ resident: true \}/)
    assert.match(main, /raw\.action === 'check'/)
    assert.match(main, /raw\.action === 'install'/)
    assert.match(main, /quitAndInstall\(\)/)
    // 品牌/数据目录经非秘密 process env（宿主插件读）；runtime 会剥离所有
    // secret-shaped env，credential handler 是唯一 key 路径。
    assert.match(main, /WEFTMATE_APP_VERSION: appVersion/)
    assert.match(main, /WEFTMATE_USER_DATA: app\.getPath\('userData'\)/)
    assert.match(main, /WEFTMATE_DSH_HOME: dshHome/)
    assert.match(main, /WEFTMATE_WORKSPACE: workspaceDir/)
    // 宿主插件入口：webserver prefix 路由挂载（与官方 client-modules 同款注册面）；
    // P1-02 起路由表/白名单下沉 gateway/legacy（http + update）。
    const host = readFileSync(new URL('../../src/plugins/weftmate-host.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(host, /export const inject = \['webServer', 'apiProxy'\]/, 'P1-03 host must wait for the official apiProxy service')
    assert.match(host, /path: '\/weftmate', handler: serveWeftmate/)
    const gatewayRouter = readFileSync(new URL('../../src/runtime/gateway/legacy/http.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(gatewayRouter, /\/weftmate\/status\.json/)
    assert.match(gatewayRouter, /\/weftmate\/update/)
    const gatewayUpdate = readFileSync(new URL('../../src/runtime/gateway/legacy/update.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(gatewayUpdate, /action !== 'check' && action !== 'install'/)
    // 当前 UI 门只允许 client plugin 提供无状态产品外壳；不重新注册旧
    // shell overlay 或模型/设置/会话的第二份状态。官方 DSH client graph
    // 继续拥有完整的交互与数据来源。
    const client = readFileSync(new URL('../../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(client, /product frame around the fixed, official client graph/)
    assert.match(client, /weftmate-electron-drag-region/)
    assert.match(client, /ocUJRa_brand::before/)
    assert.match(client, /content: "WeftMate"/)
    assert.match(client, /prefers-reduced-motion/)
    assert.match(client, /apply: function \(ctx\) \{\s*installElectronWindowChrome\(\)/)
    const clientPkg = readFileSync(new URL('../../src/plugins/weftmate-client/package.json', import.meta.url), 'utf8')
    assert.match(clientPkg, /@deepseek-ai\/dsh-client-ui-layout/)
  })
})
