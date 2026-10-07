/** Stage14R3 reviewable, offline maintenance manifest. Never controls a process. */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const PATTERN = /^inventory-\d{8}-\d{6}-[0-9a-f]{32}\.json$/
const relativeRoot = 'Stage14R3Acceptance-20261004'
const failure = (code) => Object.assign(new Error(code), { code })

export function planStage14R3(inventory, { inventoryFile, acceptanceRoot,
  configBytes, stateBytes, workerBytes, benchmarkBytes, aiRoot = 'D:\\AI',
  tokenProofFile, tokenProofBytes, workerStatusBytes, orchestratorBytes,
  allowPriorTokenForDiagnostic = false } = {}) {
  if (!inventory || inventory.schemaVersion !== 1 || inventory.elevated !== true ||
      inventory.readyForReview !== true || !Array.isArray(inventory.failures) ||
      inventory.failures.length !== 0 || inventory.readyForMaintenance !== false) {
    throw failure('INVENTORY_NOT_VERIFIED')
  }
  if (!PATTERN.test(basename(inventoryFile ?? '')) ||
      basename(acceptanceRoot ?? '') !== relativeRoot ||
      resolve(inventoryFile).toLowerCase() !==
        join(resolve(acceptanceRoot), basename(inventoryFile)).toLowerCase()) {
    throw failure('INVENTORY_PATH_INVALID')
  }
  if (sha(configBytes) !== inventory.config?.sha256 ||
      !Number.isSafeInteger(inventory.ninfer?.pid) || inventory.ninfer.pid < 1 ||
      inventory.ninfer.sessionId !== 0 || inventory.ninfer.name !== 'ninfer-serve.exe' ||
      inventory.ninfer.argvMatchesCurrentLauncherAndConfig !== true ||
      !Array.isArray(inventory.ninfer.fullArgv) || inventory.ninfer.fullArgv.length < 20 ||
      inventory.ninfer.fullArgv[0] !== inventory.ninfer.executablePath ||
      inventory.ninfer.modelSwitcherStatePidMatches !== true ||
      inventory.ninfer.switchLogReadyPidMatches !== true ||
      !workerBytes || !benchmarkBytes || !orchestratorBytes) {
    throw failure('NINFER_IDENTITY_INVALID')
  }
  if (!tokenProofFile || !/^preflight-controller-[0-9a-f-]{36}(?:-[0-9a-f]{32})?\.json$/.test(basename(tokenProofFile)) ||
      resolve(tokenProofFile).toLowerCase() !==
        join(resolve(acceptanceRoot), basename(tokenProofFile)).toLowerCase()) {
    throw failure('TOKEN_PROOF_PATH_INVALID')
  }
  let proof, workerStatus
  try {
    proof = JSON.parse(Buffer.from(tokenProofBytes).toString('utf8').replace(/^\uFEFF/, ''))
    workerStatus = JSON.parse(Buffer.from(workerStatusBytes).toString('utf8').replace(/^\uFEFF/, ''))
  } catch { throw failure('TOKEN_PROOF_UNREADABLE') }
  const expectedPids = [inventory.ninfer.pid,
    inventory.modelSwitcher?.loopbackProxyPid, inventory.modelSwitcher?.supervisorPid]
  const old = proof?.oldTokens
  const worker = workerStatus?.token
  const workerEvidenceMatches = proof?.code === 'OK'
    ? workerStatus?.kind === 's4u-preflight' && workerStatus?.ready === true &&
      workerStatus?.action === 'Preflight'
    : workerStatus?.code === 'WORKER_TOKEN_MISMATCH' &&
      workerStatus?.action === 'Preflight'
  const exactTokenPids = Array.isArray(old) && old.length === 3 &&
    old.every((item, index) => item?.pid === expectedPids[index])
  const provisionalTokenPids = allowPriorTokenForDiagnostic === true &&
    Array.isArray(old) && old.length === 3 && old[0]?.pid === expectedPids[0] &&
    old[1]?.pid !== expectedPids[1] && old[2]?.pid !== expectedPids[2]
  if (proof?.originalServicesUntouched !== true ||
      !['WORKER_TOKEN_MISMATCH', 'OK'].includes(proof?.code) ||
      !Array.isArray(old) || old.length !== 3 ||
      !workerEvidenceMatches ||
      proof?.runId !== workerStatus?.runId ||
      (proof?.nonce ?? null) !== (workerStatus?.nonce ?? null) ||
      (!exactTokenPids && !provisionalTokenPids) ||
      !old.every((item) => item?.available === true &&
        typeof item.sid === 'string' && /^S-1-5-21-(?:\d+-){3}\d+$/.test(item.sid) &&
        item.sid === old[0].sid && item.elevationType === old[0].elevationType &&
        item.integritySid === old[0].integritySid && item.name === old[0].name) ||
      !worker || worker.sid !== old[0].sid || worker.name !== old[0].name ||
      worker.sessionId !== 0 || worker.elevationType !== old[0].elevationType ||
      worker.integritySid !== old[0].integritySid) {
    throw failure('TOKEN_PROOF_MISMATCH')
  }
  const requiredToken = { sid: worker.sid, name: worker.name, sessionId: 0,
    elevationType: worker.elevationType, integritySid: worker.integritySid }
  let state
  try { state = JSON.parse(Buffer.from(stateBytes).toString('utf8').replace(/^\uFEFF/, '')) }
  catch { throw failure('MODEL_STATE_UNREADABLE') }
  if (state?.pid !== inventory.ninfer.pid || state?.dshModelId !== 'qwen3.8-27b' ||
      state?.modelPath !== inventory.ninfer.fullArgv[1]) throw failure('MODEL_STATE_MISMATCH')
  const originalArgv = inventory.ninfer.fullArgv
  if (originalArgv.some((arg) => typeof arg !== 'string' || arg.length > 1024 || !arg)) {
    throw failure('NINFER_ARGV_INVALID')
  }
  let cfg
  try { cfg = JSON.parse(Buffer.from(configBytes).toString('utf8').replace(/^\uFEFF/, '')) }
  catch { throw failure('CONFIG_UNREADABLE') }
  const expectedWorkingDirectory = win32.resolve(aiRoot, String(cfg.ninfer_dir ?? ''))
  const expectedArgv = [win32.join(expectedWorkingDirectory, 'ninfer-serve.exe'),
    win32.resolve(aiRoot, String(cfg.model ?? '')),
    '--host', String(cfg.host), '--port', String(cfg.port), '--model-id', String(cfg.alias),
    '--max-context', String(cfg.max_context), '--kv-capacity', String(cfg.kv_capacity),
    '--kv-dtype', String(cfg.kv_dtype), '--max-concurrency', String(cfg.max_concurrency),
    '--max-pending-requests', String(cfg.max_pending_requests),
    '--prefill-chunk', String(cfg.prefill_chunk)]
  if (cfg.vision === true) expectedArgv.push('--vision')
  if (cfg.spec) {
    expectedArgv.push('--spec', String(cfg.spec), '--draft-tokens', String(cfg.draft_tokens))
    if (cfg.lm_head_draft === true) expectedArgv.push('--lm-head-draft')
  }
  if (expectedWorkingDirectory.toLowerCase() !==
      inventory.config.declaredWorkingDirectory.toLowerCase() ||
      expectedArgv.length !== originalArgv.length || expectedArgv.some((value, index) =>
        index < 2 ? value.toLowerCase() !== originalArgv[index].toLowerCase()
          : value !== originalArgv[index])) throw failure('NINFER_ARGV_DIFFERS_CURRENT_CONFIG')
  const specAt = originalArgv.indexOf('--spec')
  if (specAt < 0 || originalArgv[specAt + 1] !== 'mtp' ||
      originalArgv[specAt + 2] !== '--draft-tokens' ||
      originalArgv[specAt + 3] !== '3' ||
      originalArgv[specAt + 4] !== '--lm-head-draft' ||
      specAt !== originalArgv.length - 5 ||
      originalArgv.indexOf('--spec', specAt + 1) !== -1 ||
      originalArgv.indexOf('--draft-tokens', specAt + 3) !== -1 ||
      originalArgv.indexOf('--lm-head-draft', specAt + 5) !== -1) {
    throw failure('SPEC_ARGUMENTS_NOT_EXACT')
  }
  const trialArgv = originalArgv.slice(0, specAt)
  const names = (inventory.registeredTasks ?? []).map((item) => `${item.path}${item.name}`)
  if (!names.includes('\\ModelSwitcher-A-Logon') ||
      !names.includes('\\AI\\UnifiedModelGateway-StartAll') ||
      inventory.modelSwitcher?.loopbackProxyArgvMatchesCurrentLauncher !== true ||
      inventory.modelSwitcher?.supervisorArgvMatchesCurrentLauncher !== true ||
      inventory.modelSwitcher.loopbackProxySessionId !== 0 ||
      inventory.modelSwitcher.supervisorSessionId !== 0 ||
      inventory.modelSwitcher.loopbackProxyOwner?.user !== inventory.ninfer.owner?.user ||
      inventory.modelSwitcher.supervisorOwner?.user !== inventory.ninfer.owner?.user ||
      inventory.modelSwitcher.loopbackProxyPid < 1 ||
      inventory.modelSwitcher.supervisorPid < 1) {
    throw failure('MODEL_SWITCHER_IDENTITY_INVALID')
  }
  const launcherTask = inventory.registeredTasks.find((item) =>
    item.path === '\\' && item.name === 'ModelSwitcher-A-Logon')
  if (launcherTask?.principalUserId !== inventory.ninfer.owner.user ||
      launcherTask.principalLogonType !== 'S4U' ||
      launcherTask.principalRunLevel !== 'Limited') {
    throw failure('RECOVERY_TASK_PRINCIPAL_INVALID')
  }
  const runId = randomUUID()
  return {
    schemaVersion: 1, purpose: 'stage14r3-ephemeral-ninfer-maintenance', runId,
    inventoryFile, inventorySha256: sha(readFileSync(inventoryFile)),
    acceptedAt: new Date().toISOString(),
    expectedConfigSha256: inventory.config.sha256,
    currentStateSha256: sha(stateBytes),
    workerSha256: sha(workerBytes), benchmarkSha256: sha(benchmarkBytes),
    orchestratorSha256: sha(orchestratorBytes),
    requiredToken, tokenProofFile, tokenProofSha256: sha(tokenProofBytes),
    tokenWorkerStatusSha256: sha(workerStatusBytes),
    tokenEvidenceProvisional: !exactTokenPids,
    original: { pid: inventory.ninfer.pid, createdAt: inventory.ninfer.createdAt,
      owner: inventory.ninfer.owner, sessionId: 0,
      exe: inventory.ninfer.executablePath, argv: originalArgv,
      declaredWorkingDirectory: inventory.config.declaredWorkingDirectory,
      workingDirectoryEvidence: inventory.config.workingDirectoryEvidence },
    trial: { argv: trialArgv },
    switcher: { proxyPid: inventory.modelSwitcher.loopbackProxyPid,
      proxyCreatedAt: inventory.modelSwitcher.loopbackProxyCreatedAt,
      proxyArgv: inventory.modelSwitcher.loopbackProxyFullArgv,
      proxyOwner: inventory.modelSwitcher.loopbackProxyOwner,
      supervisorPid: inventory.modelSwitcher.supervisorPid,
      supervisorCreatedAt: inventory.modelSwitcher.supervisorCreatedAt,
      supervisorArgv: inventory.modelSwitcher.supervisorFullArgv,
      supervisorOwner: inventory.modelSwitcher.supervisorOwner,
      principalUserId: launcherTask.principalUserId,
      principalLogonType: launcherTask.principalLogonType,
      principalRunLevel: launcherTask.principalRunLevel,
      registeredTask: '\\ModelSwitcher-A-Logon',
      registeredTaskAction: { execute: launcherTask.actionExecute,
        arguments: launcherTask.actionArguments,
        workingDirectory: launcherTask.actionWorkingDirectory },
      untouchedOther8081Pids: (inventory.modelSwitcher.other8081Listeners ?? []).map((item) => item.pid) },
    temporaryTaskNames: { trial: `WeftMate-Stage14R3-Trial-${runId.slice(0, 8)}`,
      recover: `WeftMate-Stage14R3-Recover-${runId.slice(0, 8)}` },
    acceptanceRoot: resolve(acceptanceRoot),
    deadlineSeconds: 720,
    readyForExecution: false,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inventoryFile, outputFile, tokenProofFile, option] = process.argv.slice(2)
  if (!inventoryFile || !outputFile || !tokenProofFile) throw new Error('usage: node stage14r3-plan.mjs <inventory.json> <manifest.json> <preflight-controller.json>')
  const acceptanceRoot = resolve(join(import.meta.dirname, '..', '..', '..', 'Runtime',
    'UnifiedAssistant', relativeRoot))
  if (resolve(outputFile).toLowerCase() !==
      join(acceptanceRoot, basename(outputFile)).toLowerCase() ||
      !/^manifest-[0-9a-f-]{36}\.json$/.test(basename(outputFile))) throw failure('MANIFEST_PATH_INVALID')
  const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8').replace(/^\uFEFF/, ''))
  const tokenProofBytes = readFileSync(tokenProofFile)
  const tokenProof = JSON.parse(tokenProofBytes.toString('utf8').replace(/^\uFEFF/, ''))
  const workerStatusFile = tokenProof.code === 'OK'
    ? join(acceptanceRoot, `preflight-${tokenProof.runId}-${tokenProof.nonce}.json`)
    : join(acceptanceRoot, `worker-status-Preflight-${tokenProof.runId}${tokenProof.nonce ? `-${tokenProof.nonce}` : ''}.json`)
  if (option && option !== '--bootstrap-token-proof') throw failure('PLAN_OPTION_INVALID')
  const manifest = planStage14R3(inventory, { inventoryFile, acceptanceRoot,
    configBytes: readFileSync('D:\\AI\\Config\\qwen3.8-27b-ninfer.json'),
    stateBytes: readFileSync('D:\\AI\\Control\\State\\ModelSwitcher\\current.json'),
    workerBytes: readFileSync(join(import.meta.dirname, 'stage14r3-worker.ps1')),
    benchmarkBytes: readFileSync(join(import.meta.dirname, 'stage14r3-ninfer-micro.mjs')),
    orchestratorBytes: readFileSync(join(import.meta.dirname, 'stage14r3-orchestrate.ps1')),
    tokenProofFile, tokenProofBytes, workerStatusBytes: readFileSync(workerStatusFile),
    allowPriorTokenForDiagnostic: option === '--bootstrap-token-proof' })
  writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`manifestFile=${outputFile} readyForExecution=false\n`)
}
