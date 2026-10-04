import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { planStage14R3 } from '../scripts/stage14r3-plan.mjs'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
test('maintenance plan changes exactly the three MTP switches and retains precise identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'stage14r3-'))
  const acceptanceRoot = join(root, 'Stage14R3Acceptance-20261004')
  const configBytes = Buffer.from(JSON.stringify({
    ninfer_dir: 'NInfer', model: 'Models\\qwen.ninfer', host: '127.0.0.1', port: 8080,
    alias: 'qwen3.8-27b', max_context: 110592, kv_capacity: 110592,
    kv_dtype: 'rk8v4', max_concurrency: 1, max_pending_requests: 8,
    prefill_chunk: 512, vision: true, spec: 'mtp', draft_tokens: 3,
    lm_head_draft: true,
  }))
  const stateBytes = Buffer.from(JSON.stringify({ pid: 101, dshModelId: 'qwen3.8-27b',
    modelPath: 'C:\\Models\\qwen.ninfer' }))
  const workerBytes = Buffer.from('synthetic-worker')
  const benchmarkBytes = Buffer.from('synthetic-micro')
  const orchestratorBytes = Buffer.from('synthetic-orchestrator')
  const inventoryFile = join(acceptanceRoot, `inventory-20261004-150000-${'a'.repeat(32)}.json`)
  const diagnosticRunId = '11111111-2222-3333-4444-555555555555'
  const nonce = 'a'.repeat(32)
  const tokenProofFile = join(acceptanceRoot,
    `preflight-controller-${diagnosticRunId}-${nonce}.json`)
  const originalArgv = ['C:\\NInfer\\ninfer-serve.exe', 'C:\\Models\\qwen.ninfer',
    '--host', '127.0.0.1', '--port', '8080', '--model-id', 'qwen3.8-27b',
    '--max-context', '110592', '--kv-capacity', '110592', '--kv-dtype', 'rk8v4',
    '--max-concurrency', '1', '--max-pending-requests', '8', '--prefill-chunk', '512',
    '--vision', '--spec', 'mtp', '--draft-tokens', '3', '--lm-head-draft']
  const owner = { domain: 'SYNTHETIC', user: 'owner' }
  const inventory = { schemaVersion: 1, elevated: true, readyForReview: true,
    readyForMaintenance: false, failures: [],
    config: { sha256: sha(configBytes), declaredWorkingDirectory: 'C:\\NInfer',
      workingDirectoryEvidence: 'launcher-declared; process-current-directory-not-observed' },
    ninfer: { pid: 101, createdAt: '2026-10-01T00:00:00Z', sessionId: 0,
      name: 'ninfer-serve.exe', executablePath: originalArgv[0],
      fullArgv: originalArgv, argvMatchesCurrentLauncherAndConfig: true,
      modelSwitcherStatePidMatches: true, switchLogReadyPidMatches: true, owner },
    modelSwitcher: { loopbackProxyPid: 102, loopbackProxyCreatedAt: '2026-10-01T00:00:01Z',
      loopbackProxyOwner: owner, loopbackProxyArgvMatchesCurrentLauncher: true,
      loopbackProxyFullArgv: ['node.exe', 'proxy.js'], loopbackProxySessionId: 0,
      supervisorPid: 103, supervisorCreatedAt: '2026-10-01T00:00:02Z',
      supervisorOwner: owner, supervisorArgvMatchesCurrentLauncher: true,
      supervisorFullArgv: ['powershell.exe', 'supervisor.ps1'], supervisorSessionId: 0,
      other8081Listeners: [{ pid: 999 }] },
    registeredTasks: [{ path: '\\', name: 'ModelSwitcher-A-Logon', principalUserId: 'owner',
      principalLogonType: 'S4U', principalRunLevel: 'Limited',
      actionExecute: 'C:\\Windows\\powershell.exe',
      actionArguments: '-File C:\\start-model-switcher.ps1', actionWorkingDirectory: '' },
    { path: '\\AI\\', name: 'UnifiedModelGateway-StartAll' }] }
  const token = { sid: 'S-1-5-21-1-2-3-1000', name: 'SYNTHETIC\\owner',
    sessionId: 0, elevationType: 'Default', integritySid: 'S-1-16-12288', adminRole: true }
  const oldTokens = [101, 102, 103].map((pid) => ({ ...token, pid, available: true }))
  const proof = { code: 'OK', originalServicesUntouched: true,
    runId: diagnosticRunId, nonce, oldTokens }
  const status = { kind: 's4u-preflight', ready: true, action: 'Preflight',
    runId: diagnosticRunId, nonce, token }
  try {
    mkdirSync(acceptanceRoot)
    writeFileSync(inventoryFile, JSON.stringify(inventory))
    writeFileSync(tokenProofFile, JSON.stringify(proof))
    const args = { inventoryFile, acceptanceRoot, configBytes, stateBytes,
      workerBytes, benchmarkBytes, orchestratorBytes, aiRoot: 'C:\\', tokenProofFile,
      tokenProofBytes: Buffer.from(JSON.stringify(proof)),
      workerStatusBytes: Buffer.from(JSON.stringify(status)) }
    const plan = planStage14R3(inventory, args)
    assert.deepEqual(plan.trial.argv, originalArgv.slice(0, -5))
    assert.deepEqual(plan.original.argv, originalArgv)
    assert.equal(plan.original.pid, 101)
    assert.equal(plan.switcher.proxyPid, 102)
    assert.equal(plan.switcher.supervisorPid, 103)
    assert.deepEqual(plan.switcher.untouchedOther8081Pids, [999])
    assert.equal(plan.readyForExecution, false)
    assert.throws(() => planStage14R3({ ...inventory, ninfer: { ...inventory.ninfer,
      pid: 104 } }, args), /TOKEN_PROOF_MISMATCH/)
    const unexpected = structuredClone(inventory)
    unexpected.ninfer.fullArgv.splice(-5, 0, '--unknown')
    assert.throws(() => planStage14R3(unexpected, args), /NINFER_ARGV_DIFFERS_CURRENT_CONFIG/)
    const changed = structuredClone(inventory)
    changed.ninfer.fullArgv[changed.ninfer.fullArgv.length - 2] = '4'
    assert.throws(() => planStage14R3(changed, args), /NINFER_ARGV_DIFFERS_CURRENT_CONFIG/)
    for (const field of ['sid', 'sessionId', 'integritySid'] as const) {
      const wrong = structuredClone(status)
      ;(wrong.token as any)[field] = field === 'sessionId' ? 1 : 'wrong'
      assert.throws(() => planStage14R3(inventory, { ...args,
        workerStatusBytes: Buffer.from(JSON.stringify(wrong)) }), /TOKEN_PROOF_MISMATCH/)
    }
    const missingOldRole = structuredClone(proof)
    missingOldRole.oldTokens.forEach((item: any) => { delete item.adminRole })
    assert.equal(planStage14R3(inventory, { ...args,
      tokenProofBytes: Buffer.from(JSON.stringify(missingOldRole)) }).requiredToken.sid, token.sid)
    const freshProcesses = structuredClone(inventory)
    freshProcesses.modelSwitcher.loopbackProxyPid = 202
    freshProcesses.modelSwitcher.supervisorPid = 203
    assert.throws(() => planStage14R3(freshProcesses, args), /TOKEN_PROOF_MISMATCH/)
    assert.equal(planStage14R3(freshProcesses, { ...args,
      allowPriorTokenForDiagnostic: true }).tokenEvidenceProvisional, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
