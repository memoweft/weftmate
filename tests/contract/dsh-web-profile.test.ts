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
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { isolatedEnv, loadPin, resolveRuntimeRoot } from './support/checkout.ts'
import { writeWebProfile } from '../../src/dsh-web-runtime.ts'

/** 子进程跑 vendored/checkout CLI 的 --dump-config（defaultOnly 控制是否含 profile 补丁层），收集输出。 */
function runDump(bin: string, home: string, defaultOnly: boolean, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, '--profile', 'weftmate', defaultOnly ? '--dump-default-config' : '--dump-config'], {
      cwd: home,
      env: isolatedEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: null, stdout, stderr: stderr + '\n[dump timed out]' })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
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
      assert.match(withLayer.stdout, /- id: '@weftmate\/client'\s*\n\s*name: '@weftmate\/client'/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('main 壳接线：工作区默认值 / 凭据接缝 / Electron 启动旗标（R2-02 / R1-04）', () => {
    const main = readFileSync(new URL('../../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    // 工作区默认值 = userData/workspace（REQUIREMENTS R2-02 口径；子进程 cwd → sandbox workspaceRoot）。
    assert.match(main, /const workspaceDir = join\(app\.getPath\('userData'\), 'workspace'\)/)
    // 凭据接缝：safeStorage 解密 → 只经子进程 env（DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL），不落盘。
    assert.match(main, /env\.DEEPSEEK_API_KEY = llm\.apiKey/)
    assert.match(main, /env\.DEEPSEEK_BASE_URL = llm\.baseUrl/)
    assert.doesNotMatch(main, /writeFileSync\([^)]*DEEPSEEK_API_KEY|credentials\.yaml/, 'key 不得由 main 落盘')
    // Electron 形态 spawn 官方 CLI 的旗标（dsh-web-runtime 内 --expose-internals 兜底通道）。
    const runtime = readFileSync(new URL('../../src/dsh-web-runtime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(runtime, /const nodeArgs = this\.opts\.nodeElectron \? \['--expose-internals'\] : \[\]/)
    assert.match(runtime, /env\.DSH_TELEMETRY_DISABLED = '1'/)
    assert.match(runtime, /env\.ELECTRON_RUN_AS_NODE = '1'/)
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
    // 品牌/数据目录经子进程 env（宿主插件读）。
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
    // 客户端：轮询状态面 + 已下载时「重启安装」动作（只有 updateReady 才恢复 pointer-events）。
    const client = readFileSync(new URL('../../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(client, /fetch\('\/weftmate\/status\.json'/)
    assert.match(client, /fetch\('\/weftmate\/update'/)
    assert.match(client, /action: 'install'/)
    assert.match(client, /update\.status === 'downloaded'/)
    assert.match(client, /name: 'shell\.overlay'/)
    // R3-01 真机修复锁：槽位注册必须走官方「声明等待」接缝（slots.inject），并声明挂载顺序边
    // （inject 边指到声明者 ui-layout 与 runtime）——直接 register 会在声明者未挂时 fail-loud
    // （真机报错：slot "shell.overlay" is not declared）。
    assert.match(client, /ctx\.slots\.inject\('shell\.overlay', function \(\) \{/)
    assert.match(client, /return ctx\.slots\.register\(\{/)
    const clientPkg = readFileSync(new URL('../../src/plugins/weftmate-client/package.json', import.meta.url), 'utf8')
    assert.match(clientPkg, /@deepseek-ai\/dsh-client-ui-layout/)
  })
})
