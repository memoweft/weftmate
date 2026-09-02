#!/usr/bin/env node
/** Launch an exact isolated installed candidate with a Node IPC quit channel. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function option(name, required = true) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? '' : process.argv[index + 1]
  if (required && (!value || value.startsWith('--'))) throw new Error(`${name} is required`)
  return value
}

function isolatedPath(value, segment) {
  const target = resolve(value)
  const pattern = new RegExp(`[\\\\/]WeftMate[\\\\/]Runtime[\\\\/]Stage3[\\\\/]${segment}`,'i')
  if (!pattern.test(target)) throw new Error(`path is outside the Stage 3 isolated ${segment} root`)
  return target
}

const exe = isolatedPath(option('--exe'), 'install')
const userData = isolatedPath(option('--user-data-dir'), 'data')
const feed = option('--feed', false)
if (!existsSync(exe)) throw new Error('installed executable is missing')
if (feed && !/^http:\/\/127\.0\.0\.1:\d+(?:\/.*)?$/.test(feed)) throw new Error('feed must be an explicit loopback URL')

const env = { ...process.env }
for (const name of Object.keys(env)) {
  if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASS(?:WORD)?|CSC_LINK|CSC_KEY_PASSWORD/i.test(name)) delete env[name]
}
env.WEFTMATE_USER_DATA = userData
env.WEFTMATE_DOGFOOD_CONTROL = '1'
if (feed) env.WEFTMATE_UPDATE_FEED = feed
else delete env.WEFTMATE_UPDATE_FEED
delete env.WEFTMATE_DSH_CHECKOUT
delete env.WEFTMATE_DSH_RUNTIME

const child = spawn(exe, [], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: false })
console.log(JSON.stringify({ started: true, pid: child.pid, ipcQuit: true }))

let quitSent = false
function requestQuit() {
  if (quitSent || !child.connected) return
  quitSent = true
  child.send({ type: 'weftmate:quit' })
  console.log(JSON.stringify({ quitRequested: true }))
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (String(chunk).trim().toLowerCase() === 'q') requestQuit()
})
process.on('SIGINT', requestQuit)
child.on('error', () => { process.exitCode = 1 })
child.on('exit', (code, signal) => {
  console.log(JSON.stringify({ exited: true, code, signal: signal ?? null }))
  process.stdin.pause()
  process.exitCode = signal ? 1 : (code ?? 1)
})
