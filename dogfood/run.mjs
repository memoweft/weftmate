/**
 * WeftMate 隔离开发候选启动器。
 *
 * 始终使用 WeftMate 仓内的独立 vendor DSH 与独立 userData：
 *   npm run dogfood -- --dsh vendor
 *   npm run dogfood -- --dsh vendor --dsh-path 'Z:\\独立的dsh-runtime'
 *
 * DSH 使用 `--port 0` 让操作系统分配独立 loopback 端口；没有固定 7788/7899 契约。
 * MemoWeft 试验接缝默认关闭；AI-GAME 由 WeftMate 受管启动，普通 DSH 不依赖它就绪。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const defaultUserData = join(here, 'data', 'stage-1')
const defaultVendor = join(projectRoot, 'vendor', 'dsh-runtime')

function usage() {
  return [
    '用法：npm run dogfood -- [--dsh vendor] [--dsh-path <独立 vendor runtime 路径>]',
    '      [--user-data-dir <隔离目录>] [--ai-game-runtime-root <受管运行时目录>] [--dry-run]',
    '',
    '示例：',
    '  npm run dogfood -- --dsh vendor',
    "  npm run dogfood -- --dsh vendor --dsh-path 'Z:\\独立的dsh-runtime'",
  ].join('\n')
}

function optionValue(args, index, name) {
  const arg = args[index]
  if (arg.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: index }
  if (arg === name) {
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
      throw new Error(`${name} 缺少值`)
    }
    return { value: args[index + 1], next: index + 1 }
  }
  return null
}

function parseArgs(args) {
  const out = { dsh: 'vendor', dshPath: null, userData: defaultUserData, aiGameRuntimeRoot: null, dryRun: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') { out.dryRun = true; continue }
    if (arg === '--help' || arg === '-h') { out.help = true; continue }
    const dsh = optionValue(args, index, '--dsh')
    if (dsh) { out.dsh = dsh.value; index = dsh.next; continue }
    const dshPath = optionValue(args, index, '--dsh-path')
    if (dshPath) { out.dshPath = dshPath.value; index = dshPath.next; continue }
    const userData = optionValue(args, index, '--user-data-dir')
    if (userData) { out.userData = userData.value; index = userData.next; continue }
    const runtimeRoot = optionValue(args, index, '--ai-game-runtime-root')
    if (runtimeRoot) { out.aiGameRuntimeRoot = runtimeRoot.value; index = runtimeRoot.next; continue }
    throw new Error(`未知参数：${arg}`)
  }
  if (out.help) return out
  if (out.dsh !== 'vendor') {
    throw new Error('WeftMate 只允许使用产品自有 vendor DSH；不能选择个人/shared checkout')
  }
  return out
}

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(`[dogfood] 参数错误：${error instanceof Error ? error.message : String(error)}\n\n${usage()}`)
  process.exit(2)
}

if (options.help) {
  console.log(usage())
  process.exit(0)
}

const userDataDir = resolve(projectRoot, options.userData)
const dshRoot = resolve(projectRoot, options.dshPath ?? defaultVendor)
const childEnv = { ...process.env }
delete childEnv.WEFTMATE_DSH_CHECKOUT
delete childEnv.WEFTMATE_DSH_RUNTIME
childEnv.WEFTMATE_DSH_RUNTIME = dshRoot
childEnv.WEFTMATE_USER_DATA = userDataDir
childEnv.WEFTMATE_MEMOWEFT_ENABLED = '0'
childEnv.WEFTMATE_DOGFOOD_CONTROL = '1'
delete childEnv.WEFTMATE_AI_GAME_ORIGIN
if (options.aiGameRuntimeRoot) childEnv.WEFTMATE_AI_GAME_RUNTIME_ROOT = resolve(projectRoot, options.aiGameRuntimeRoot)

const config = {
  mode: options.dsh,
  dshRoot,
  dshRootExists: existsSync(dshRoot),
  userData: userDataDir,
  port: 'dynamic-loopback',
  memoweft: 'disabled',
  aiGame: options.aiGameRuntimeRoot ? 'managed-configured' : 'not-configured',
  runtimeEnv: {
    WEFTMATE_DSH_CHECKOUT: childEnv.WEFTMATE_DSH_CHECKOUT ?? null,
    WEFTMATE_DSH_RUNTIME: childEnv.WEFTMATE_DSH_RUNTIME ?? null,
  },
}

console.log('[dogfood] CONFIG ' + JSON.stringify(config))
console.log('[dogfood] 端口由 OS 动态分配；实际地址以 “[weftmate] ✓ DSH web 运行时就绪” 日志为准。')
console.log('[dogfood] MemoWeft 已关闭；AI-GAME 由宿主按需受管，普通 DSH 对话不依赖本地端口。')

if (options.dryRun) process.exit(0)

mkdirSync(userDataDir, { recursive: true })

const require = createRequire(import.meta.url)
let electronBin
try {
  electronBin = require('electron')
} catch {
  console.error('[dogfood] 找不到 Electron。请把此错误交给工程代理；当前构建尚未准备好。')
  process.exit(1)
}

console.log('[dogfood] electron =', electronBin)
const child = spawn(
  electronBin,
  ['.', `--user-data-dir=${userDataDir}`],
  {
    cwd: projectRoot,
    // Electron 本身不读终端输入；stdin 留给 launcher 的 q/quit 干净退出控制。
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: childEnv,
  },
)

let stopping = false
let hardStopTimer = null
let inputBuffer = ''

function hardStop() {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  console.error('[dogfood] Electron 未在 10 秒内干净退出，开始终止本次启动的精确进程树。')
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.unref()
  } else {
    try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  }
}

function requestCleanQuit(signal) {
  if (stopping) return
  stopping = true
  console.log(`[dogfood] 收到 ${signal}，请求 Electron 走应用内 shutdown（关闭流程）…`)
  if (child.connected) {
    child.send({ type: 'weftmate:quit', source: 'dogfood-launcher' }, (error) => {
      if (error) console.error('[dogfood] 发送干净退出请求失败，将等待有界兜底：', error.message)
    })
  }
  hardStopTimer = setTimeout(hardStop, 10_000)
  hardStopTimer.unref?.()
}

function stopReadingInput() {
  process.stdin.off('data', handleInput)
  process.stdin.pause()
}

function handleInput(chunk) {
  inputBuffer += chunk
  const lines = inputBuffer.split(/[\r\n]+/)
  inputBuffer = lines.pop() ?? ''
  for (const line of lines) {
    const command = line.trim().toLowerCase()
    if (command === 'q' || command === 'quit') requestCleanQuit('终端 q')
  }
}

if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdin.on('data', handleInput)
  console.log('[dogfood] 退出：使用应用托盘菜单；或在此终端输入 q 后回车（Windows 干净退出证据请用 q，不用 Ctrl+C）。')
}

child.on('error', (error) => {
  if (hardStopTimer) clearTimeout(hardStopTimer)
  stopReadingInput()
  console.error('[dogfood] 启动 Electron 失败:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (hardStopTimer) clearTimeout(hardStopTimer)
  stopReadingInput()
  if (signal) {
    console.error(`[dogfood] Electron 被信号 ${signal} 终止；这不算干净退出证据。`)
    process.exitCode = 1
    return
  }
  console.log(`[dogfood] Electron 已完成应用内退出（code ${code ?? 'null'}）。`)
  process.exitCode = code ?? 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => requestCleanQuit(signal))
}
