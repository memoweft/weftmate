import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const clientPath = join(process.cwd(), 'src', 'plugins', 'weftmate-alpha2-client', 'client.js')

test('alpha2 Weave client uses the official Session remote and stable slots', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /inject: \['slots', 'remote', 'remote\.session', 'sessions', 'uiWorkspace'\]/)
  assert.match(source, /remote\.session\.list\(\{\}\)/)
  assert.match(source, /remote\.session\.create\(\{\}\)/)
  assert.match(source, /remote\.session\.cancel\(/)
  assert.match(source, /remote\.session\.follow\(/)
  assert.match(source, /ctx\.uiWorkspace\.openSession/)
  assert.match(source, /sessions: page === 'chat'/)
  assert.match(source, /data-weftmate-new-session/)
  assert.match(source, /conversation\.view/)
  assert.match(source, /data-weftmate-workbench-toggle-global/)
  assert.doesNotMatch(source, /weftmate-alpha2-overlay'.*ShellOverlay/)
  assert.match(source, /Do not mount the old fixed ShellOverlay/)
  assert.doesNotMatch(source, /var navigation = h\(Header, \{ ui: props\.ui \}\)/)
  assert.doesNotMatch(source, /function Header\(/)
  assert.doesNotMatch(source, /function WorkbenchButton\(/)
  assert.match(source, /turn\/end/)
  assert.match(source, /模型流已中止，等待 DSH turn\/end/)
  assert.match(source, /DSH 已确认 turn\/end：本轮已停止/)
  assert.match(source, /event\.type === 'turn\/start'[\s\S]*setStopping\(false\)/)
  assert.match(source, /发送与附件继续使用下方 DSH 官方输入区/)
  assert.doesNotMatch(source, /给智能体发消息/)
  assert.doesNotMatch(source, /ctx\.apiProxy/)
  assert.doesNotMatch(source, /localStorage/)
})

test('alpha2 Weave client makes unconnected product areas explicit', async () => {
  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /fetch\('\/api\/weftmate\/status'/)
  assert.match(source, /function unready\(label, key\)/)
  assert.match(source, /alpha\.2 宿主能力当前为未接入/)
  assert.match(source, /不读取或保存密钥/)
})
