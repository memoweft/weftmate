/**
 * MemoWeft 2.0.0 pin（P2-01）：`tests/contract/memoweft-pin.json` 是集成目标的
 * 单一事实源（version / schema / 桥协议版本 / 工件树哈希），与 DSH dsh-pin.json
 * 同纪律：升级只由 owner 触发。
 *
 * `probeInstalledMemoWeft` 用桥同款 python 直接问已装环境（importlib.metadata +
 * 确定性树哈希）；`compareMemoWeft` 把任何漂移变成**明确报错**（期望/实况/恢复指引）。
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface MemoWeftPin {
  memoProtocolVersion: number
  schemaVersion: number
  packageVersion: string
  artifactSha256: string
  recordedAt: string
}

/** 桥 python（与 weftmate-memory 插件同一 env 接缝；缺省 = 本机开发 venv）。 */
export const MEMOWEFT_PYTHON = process.env.WEFTMATE_MEMOWEFT_PYTHON ?? 'D:\\AIProjects\\WeftMate\\Runtime\\MemoWeftVenv\\Scripts\\python.exe'

export function memoweftBridgeAvailable(python = MEMOWEFT_PYTHON): boolean {
  return existsSync(python)
}

export async function loadMemoWeftPin(contractDir: string): Promise<MemoWeftPin> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(join(contractDir, 'memoweft-pin.json'), 'utf8')
  const pin = JSON.parse(text) as Partial<MemoWeftPin>
  const missing: string[] = []
  if (typeof pin.memoProtocolVersion !== 'number') missing.push('memoProtocolVersion')
  if (typeof pin.schemaVersion !== 'number') missing.push('schemaVersion')
  if (typeof pin.packageVersion !== 'string' || pin.packageVersion.length === 0) missing.push('packageVersion')
  if (typeof pin.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.artifactSha256)) missing.push('artifactSha256')
  if (typeof pin.recordedAt !== 'string' || pin.recordedAt.length === 0) missing.push('recordedAt')
  if (missing.length > 0) {
    throw new Error(`memoweft-pin.json 缺字段或非法：${missing.join(', ')}\n原文：${text.slice(0, 200)}`)
  }
  return pin as MemoWeftPin
}

const PROBE_PY = `
import hashlib, importlib.metadata as md, json, os, pathlib
import memoweft
from memoweft.integrations.dsh_bridge.protocol_v2 import DSH_RPC_PROTOCOL_VERSION
from memoweft.store.schema import SCHEMA_VERSION
dist = md.distribution('memoweft')
root = pathlib.Path(memoweft.__file__).resolve().parent
lines = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = sorted(name for name in dirnames if name != '__pycache__')
    for name in sorted(filenames):
        if name.endswith(('.pyc', '.pyo')):
            continue
        p = pathlib.Path(dirpath) / name
        rel = 'memoweft/' + p.relative_to(root).as_posix()
        h = hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        lines.append(f"{rel}\\n{p.stat().st_size}\\n{h.hexdigest()}")
print(json.dumps({
    'version': dist.version,
    'schemaVersion': SCHEMA_VERSION,
    'memoProtocolVersion': DSH_RPC_PROTOCOL_VERSION,
    'artifactSha256': hashlib.sha256("\\n".join(lines).encode()).hexdigest(),
}))
`

export interface InstalledMemoWeft {
  version: string
  schemaVersion: number
  memoProtocolVersion: number
  artifactSha256: string
}

/** 问桥 python：当前环境里实际安装的 MemoWeft 版本与工件树哈希。 */
export async function probeInstalledMemoWeft(python = MEMOWEFT_PYTHON): Promise<InstalledMemoWeft> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', PROBE_PY], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => { stdout += c })
    child.stderr.on('data', (c: string) => { stderr += c })
    const timer = setTimeout(() => child.kill(), 60_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`[memoweft-pin] 无法执行桥 python（${python}）：${error.message}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(`[memoweft-pin] 探针输出不可解析。stderr:\n${stderr.slice(-1000)}\nstdout:\n${stdout.slice(-500)}`))
      }
    })
  })
}

export interface MemoWeftMismatch {
  field: 'packageVersion' | 'schemaVersion' | 'memoProtocolVersion' | 'artifactSha256'
  expected: string | number
  found: string | number
}

/**
 * pin ↔ 已装环境的比对结果。任何漂移都必须能一句话说清「差在哪、怎么恢复」，
 * 这就是 P2-01 的 verify 判据：版本不匹配时明确报错，绝不静默继续。
 */
export function compareMemoWeft(pin: MemoWeftPin, installed: InstalledMemoWeft): { ok: true } | { ok: false; mismatches: MemoWeftMismatch[]; message: string } {
  const mismatches: MemoWeftMismatch[] = []
  if (installed.version !== pin.packageVersion) mismatches.push({ field: 'packageVersion', expected: pin.packageVersion, found: installed.version })
  if (installed.schemaVersion !== pin.schemaVersion) mismatches.push({ field: 'schemaVersion', expected: pin.schemaVersion, found: installed.schemaVersion })
  if (installed.memoProtocolVersion !== pin.memoProtocolVersion) mismatches.push({ field: 'memoProtocolVersion', expected: pin.memoProtocolVersion, found: installed.memoProtocolVersion })
  if (installed.artifactSha256 !== pin.artifactSha256) mismatches.push({ field: 'artifactSha256', expected: pin.artifactSha256, found: installed.artifactSha256 })
  if (mismatches.length === 0) return { ok: true }
  const detail = mismatches.map((m) => `- ${m.field}: 期望 ${m.expected}，实况 ${m.found}`).join('\n')
  return {
    ok: false,
    mismatches,
    message: [
      '[memoweft-pin] MemoWeft 环境与冻结基线不一致 —— 拒绝继续（P2-01 纪律：不静默）。',
      detail,
      `恢复指引：把桥 python（当前 ${MEMOWEFT_PYTHON}）恢复为 pin 声明的 memoweft-${pin.packageVersion} / schema ${pin.schemaVersion} / RPC v${pin.memoProtocolVersion}，`,
      '或在明确升级后更新 tests/contract/memoweft-pin.json 并重跑 npm run test:contract。',
    ].join('\n'),
  }
}
