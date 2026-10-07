# Read-only Stage14R3 inventory. No model HTTP request, process control or secret reads.
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$aiRoot = 'D:\AI'
$configFile = Join-Path $aiRoot 'Config\qwen3.8-27b-ninfer.json'
$launcherFile = Join-Path $aiRoot 'Control\Scripts\qwen38-ninfer.ps1'
$switcherStateFile = Join-Path $aiRoot 'Control\State\ModelSwitcher\switcher.json'
$modelStateFile = Join-Path $aiRoot 'Control\State\ModelSwitcher\current.json'
$switchLogFile = Join-Path $aiRoot 'Control\Logs\ModelSwitcher\switch.log'
$outputRoot = Join-Path (Split-Path -Parent $repo) 'Runtime\UnifiedAssistant\Stage14R3Acceptance-20261004'
$outputFile = Join-Path $outputRoot ('inventory-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.json')

$source = @'
using System;
using System.Runtime.InteropServices;
public static class WeftMateArgv {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern IntPtr CommandLineToArgvW(string line, out int count);
  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr pointer);
  public static string[] Parse(string line) {
    int count;
    IntPtr values = CommandLineToArgvW(line, out count);
    if (values == IntPtr.Zero || count < 1 || count > 64) throw new InvalidOperationException("argv unavailable");
    try {
      string[] result = new string[count];
      for (int index = 0; index < count; index++)
        result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, index * IntPtr.Size));
      return result;
    } finally { LocalFree(values); }
  }
}
'@
Add-Type -TypeDefinition $source

$failures = New-Object 'System.Collections.Generic.List[string]'
function Fail([string]$code) { if (-not $failures.Contains($code)) { $failures.Add($code) } }
function Hash-File([string]$file) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Fail 'FILE_MISSING'; return $null }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Test-CredentialLikeArguments([string[]]$parsedArgs) {
  foreach ($argument in $parsedArgs) {
    if ($argument -match '(?i)^--?(?:api[-_]?key|key|token|auth(?:orization)?|auth[-_]?token|access[-_]?token|secret|client[-_]?secret|password|passwd)(?:=|:|$)' -or
        $argument -match '(?i)^Bearer(?:\s|$)' -or
        $argument -match '^sk-[A-Za-z0-9_-]{8,}$') { return $true }
  }
  return $false
}
function Exact-Argv([string[]]$actual, [string[]]$expected, [int[]]$pathIndexes) {
  if ($null -eq $actual -or $actual.Count -ne $expected.Count) { return $false }
  for ($index = 0; $index -lt $expected.Count; $index++) {
    $comparison = if ($pathIndexes -contains $index) {
      [StringComparison]::OrdinalIgnoreCase
    } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals($actual[$index], $expected[$index], $comparison)) { return $false }
  }
  return $true
}
function Listener([int]$port, [string]$address) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq $address } | Select-Object -Unique LocalAddress,LocalPort,OwningProcess)
}
function Process-Facts([int]$processId) {
  if ($processId -lt 1) { Fail 'PROCESS_ID_INVALID'; return $null }
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $entry) { Fail 'PROCESS_MISSING'; return $null }
  $owner = $null
  try {
    $result = Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction Stop
    if ($result.ReturnValue -eq 0 -and $result.User) {
      $owner = [pscustomobject]@{ domain = [string]$result.Domain; user = [string]$result.User }
    }
  } catch { }
  if ($null -eq $owner) { Fail 'PROCESS_OWNER_UNKNOWN' }
  if (-not $entry.ExecutablePath) { Fail 'PROCESS_EXE_UNKNOWN' }
  if (-not $entry.CommandLine) { Fail 'PROCESS_ARGV_UNKNOWN' }
  return [pscustomobject]@{
    pid = [int]$entry.ProcessId
    parentPid = [int]$entry.ParentProcessId
    sessionId = [int]$entry.SessionId
    name = [string]$entry.Name
    createdAt = if ($entry.CreationDate) { ([datetime]$entry.CreationDate).ToString('o') } else { $null }
    executablePath = if ($entry.ExecutablePath) { [string]$entry.ExecutablePath } else { $null }
    owner = $owner
    rawCommandLine = if ($entry.CommandLine) { [string]$entry.CommandLine } else { $null }
  }
}
function Safe-Command([object]$process, [string]$expectedToken) {
  if ($null -eq $process -or -not $process.rawCommandLine) { return $null }
  $line = [string]$process.rawCommandLine
  $parsedArgs = $null
  try { $parsedArgs = [WeftMateArgv]::Parse($line) } catch { Fail 'PROCESS_ARGV_UNPARSEABLE'; return $null }
  if (Test-CredentialLikeArguments $parsedArgs) {
    Fail 'PROCESS_ARGV_CONTAINS_CREDENTIAL_LIKE_TEXT'; return $null
  }
  $found = @($parsedArgs | Where-Object {
    [string]::Equals($_, $expectedToken, [StringComparison]::OrdinalIgnoreCase) -or
    [string]::Equals([IO.Path]::GetFileName($_), $expectedToken, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($found.Count -ne 1) { Fail 'PROCESS_ARGV_IDENTITY_MISMATCH'; return $null }
  return @($parsedArgs)
}
function Task-Facts([string]$taskName, [string]$taskPath) {
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
  if ($null -eq $task) { Fail 'REGISTERED_TASK_MISSING'; return $null }
  $actions = @($task.Actions)
  if ($actions.Count -ne 1) { Fail 'REGISTERED_TASK_ACTION_AMBIGUOUS'; return $null }
  $action = $actions[0]
  $taskArguments = [WeftMateArgv]::Parse([string]$action.Arguments)
  if (Test-CredentialLikeArguments $taskArguments) {
    Fail 'REGISTERED_TASK_ACTION_CREDENTIAL_LIKE'; return $null
  }
  $expectedTaskArguments = if ($taskName -eq 'ModelSwitcher-A-Logon') {
    @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      (Join-Path $aiRoot 'Control\Scripts\start-model-switcher.ps1'), '-Quiet', '-StartupTimeoutSeconds', '40')
  } else {
    @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      (Join-Path $aiRoot 'Tools\UnifiedModelGateway\start-all.ps1'))
  }
  if (-not (Exact-Argv $taskArguments $expectedTaskArguments @(5))) {
    Fail 'REGISTERED_TASK_ACTION_CHANGED'; return $null
  }
  return [ordered]@{
    name = $taskName; path = $taskPath; state = [string]$task.State
    principalUserId = [string]$task.Principal.UserId
    principalLogonType = [string]$task.Principal.LogonType
    principalRunLevel = [string]$task.Principal.RunLevel
    actionExecute = [string]$action.Execute
    actionArguments = [string]$action.Arguments
    actionWorkingDirectory = [string]$action.WorkingDirectory
    restartCount = [int]$task.Settings.RestartCount
    restartInterval = [string]$task.Settings.RestartInterval
    multipleInstances = [string]$task.Settings.MultipleInstances
    startWhenAvailable = [bool]$task.Settings.StartWhenAvailable
  }
}

if ($SelfTest) {
  $extraAccepted = Exact-Argv @('exe', '--draft-tokens', '3', '--unknown') @('exe', '--draft-tokens', '3') @(0)
  if ((Test-CredentialLikeArguments @('ninfer-serve.exe', '--draft-tokens', '3')) -or
      (Test-CredentialLikeArguments @('ninfer-serve.exe', '--max-tokens', '64')) -or
      -not (Test-CredentialLikeArguments @('ninfer-serve.exe', '--api-key', 'synthetic-value')) -or
      -not (Test-CredentialLikeArguments @('ninfer-serve.exe', '--access-token=synthetic-value')) -or
      -not (Test-CredentialLikeArguments @('ninfer-serve.exe', 'sk-syntheticvalue123')) -or
      -not (Test-CredentialLikeArguments @('ninfer-serve.exe', 'Bearer', 'synthetic-value')) -or
      -not (Exact-Argv @('exe', '--draft-tokens', '3') @('exe', '--draft-tokens', '3') @(0)) -or
      $extraAccepted) {
    throw 'credential flag classifier self-test failed'
  }
  Write-Output 'stage14r3-inventory-selftest=passed'
  exit 0
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$inventory = [ordered]@{
  schemaVersion = 1
  purpose = 'stage14r3-read-only-maintenance-inventory'
  at = (Get-Date).ToString('o')
  host = $env:COMPUTERNAME
  elevated = $false
  config = $null
  ninfer = $null
  modelSwitcher = $null
  registeredTasks = $null
  failures = @()
  readyForReview = $false
  readyForMaintenance = $false
}
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $inventory.elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $cfg = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $modelPath = [IO.Path]::GetFullPath((Join-Path $aiRoot ([string]$cfg.model)))
  $workingDirectory = [IO.Path]::GetFullPath((Join-Path $aiRoot ([string]$cfg.ninfer_dir)))
  $expectedExe = Join-Path $workingDirectory 'ninfer-serve.exe'
  $configHash = Hash-File $configFile
  $launcherHash = Hash-File $launcherFile
  $inventory.config = [ordered]@{
    path = $configFile; sha256 = $configHash; launcherPath = $launcherFile
    launcherSha256 = $launcherHash; lastWriteBeforeCurrentLaunch = $null
    declaredWorkingDirectory = $workingDirectory
    workingDirectoryEvidence = 'launcher-declared; process-current-directory-not-observed'
  }
  if ([string]$cfg.host -ne '127.0.0.1' -or [int]$cfg.port -ne 8080 -or
      [string]$cfg.dsh_model_id -ne 'qwen3.8-27b') { Fail 'CONFIG_IDENTITY_MISMATCH' }
  $listeners8080 = @(Listener 8080 '127.0.0.1')
  if ($listeners8080.Count -ne 1) { Fail 'NINFER_LISTENER_AMBIGUOUS' }
  $ninferPid = if ($listeners8080.Count -eq 1) { [int]$listeners8080[0].OwningProcess } else { 0 }
  $ninfer = Process-Facts $ninferPid
  $actualArgs = Safe-Command $ninfer $modelPath
  $expectedArgs = @(
    $expectedExe, $modelPath, '--host', '127.0.0.1', '--port', '8080',
    '--model-id', [string]$cfg.alias, '--max-context', [string]$cfg.max_context,
    '--kv-capacity', [string]$cfg.kv_capacity, '--kv-dtype', [string]$cfg.kv_dtype,
    '--max-concurrency', [string]$cfg.max_concurrency,
    '--max-pending-requests', [string]$cfg.max_pending_requests,
    '--prefill-chunk', [string]$cfg.prefill_chunk
  )
  if ($cfg.vision -eq $true) { $expectedArgs += '--vision' }
  if ($cfg.spec) {
    $expectedArgs += @('--spec', [string]$cfg.spec, '--draft-tokens', [string]$cfg.draft_tokens)
    if ($cfg.lm_head_draft -eq $true) { $expectedArgs += '--lm-head-draft' }
  }
  $argsMatch = $null -ne $actualArgs -and $actualArgs.Count -eq $expectedArgs.Count
  if ($argsMatch) {
    for ($index = 0; $index -lt $expectedArgs.Count; $index++) {
      $equal = if ($index -lt 2) {
        [string]::Equals($actualArgs[$index], $expectedArgs[$index], [StringComparison]::OrdinalIgnoreCase)
      } else { [string]::Equals($actualArgs[$index], $expectedArgs[$index], [StringComparison]::Ordinal) }
      if (-not $equal) { $argsMatch = $false; break }
    }
  }
  if ($null -ne $actualArgs -and -not $argsMatch) { Fail 'NINFER_ARGV_DIFFERS_FROM_LAUNCHER' }
  if ($ninfer -and $ninfer.executablePath -and -not [string]::Equals($ninfer.executablePath, $expectedExe,
    [StringComparison]::OrdinalIgnoreCase)) { Fail 'NINFER_EXE_MISMATCH' }
  if ($ninfer -and $ninfer.name -ine 'ninfer-serve.exe') { Fail 'NINFER_NAME_MISMATCH' }
  if ($ninfer -and $ninfer.createdAt) {
    $created = [datetime]$ninfer.createdAt
    $inventory.config.lastWriteBeforeCurrentLaunch =
      (Get-Item -LiteralPath $configFile).LastWriteTime -lt $created -and
      (Get-Item -LiteralPath $launcherFile).LastWriteTime -lt $created
    if (-not $inventory.config.lastWriteBeforeCurrentLaunch) { Fail 'INPUTS_CHANGED_AFTER_LAUNCH' }
  }
  $modelState = Get-Content -LiteralPath $modelStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($ninfer -and [int]$modelState.pid -ne $ninfer.pid) { Fail 'MODEL_SWITCHER_STATE_PID_MISMATCH' }
  $readyLine = Get-Content -LiteralPath $switchLogFile -Tail 100 |
    Where-Object { $_ -match "ready qwen3\.8-27b pid=$ninferPid\b" } | Select-Object -Last 1
  if (-not $readyLine) { Fail 'SWITCH_LOG_READY_PID_MISSING' }
  $inventory.ninfer = [ordered]@{
    pid = $ninferPid
    parentPid = if ($ninfer) { $ninfer.parentPid } else { $null }
    sessionId = if ($ninfer) { $ninfer.sessionId } else { $null }
    name = if ($ninfer) { $ninfer.name } else { $null }
    createdAt = if ($ninfer) { $ninfer.createdAt } else { $null }
    executablePath = if ($ninfer) { $ninfer.executablePath } else { $null }
    owner = if ($ninfer) { $ninfer.owner } else { $null }
    fullArgv = if ($argsMatch) { $actualArgs } else { $null }
    argvMatchesCurrentLauncherAndConfig = [bool]$argsMatch
    actualWorkingDirectory = $null
    workingDirectoryVerified = $false
    listener = '127.0.0.1:8080'
    modelSwitcherStatePidMatches = $ninfer -and [int]$modelState.pid -eq $ninfer.pid
    switchLogReadyPidMatches = [bool]$readyLine
  }
  $switcher = Get-Content -LiteralPath $switcherStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $proxyPid = [int]$switcher.proxyPid
  $supervisorPid = [int]$switcher.supervisorPid
  $listeners8081 = @(Listener 8081 '127.0.0.1')
  if ($listeners8081.Count -ne 1 -or [int]$listeners8081[0].OwningProcess -ne $proxyPid) {
    Fail 'MODEL_SWITCHER_LOOPBACK_LISTENER_MISMATCH'
  }
  $proxy = Process-Facts $proxyPid
  $supervisor = Process-Facts $supervisorPid
  $proxyArgs = Safe-Command $proxy 'model-switch-proxy.js'
  $supervisorArgs = Safe-Command $supervisor 'model-switcher-supervisor.ps1'
  $expectedProxyArgs = @([string]$switcher.node,
    [string]$switcher.proxyScript, '--listen-host', '127.0.0.1',
    '--listen-port', '8081', '--upstream', 'http://127.0.0.1:8080',
    '--root', $aiRoot, '--switch-script', (Join-Path $aiRoot 'Control\Scripts\switch-local-model.ps1'),
    '--log-dir', (Join-Path $aiRoot 'Control\Logs\ModelSwitcher'))
  $expectedSupervisorArgs = @((Get-Command powershell.exe -ErrorAction Stop).Source,
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $aiRoot 'Control\Scripts\model-switcher-supervisor.ps1'))
  $proxyArgsMatch = Exact-Argv $proxyArgs $expectedProxyArgs @(0,1,9,11,13)
  $supervisorArgsMatch = Exact-Argv $supervisorArgs $expectedSupervisorArgs @(0,6)
  if ($null -ne $proxyArgs -and -not $proxyArgsMatch) { Fail 'MODEL_SWITCHER_PROXY_ARGV_CHANGED' }
  if ($null -ne $supervisorArgs -and -not $supervisorArgsMatch) { Fail 'MODEL_SWITCHER_SUPERVISOR_ARGV_CHANGED' }
  if ($proxy -and $proxy.executablePath -and -not [string]::Equals($proxy.executablePath,
    [string]$switcher.node, [StringComparison]::OrdinalIgnoreCase)) { Fail 'MODEL_SWITCHER_PROXY_EXE_MISMATCH' }
  if ($supervisor -and $supervisor.executablePath -and -not [string]::Equals($supervisor.executablePath,
    $expectedSupervisorArgs[0], [StringComparison]::OrdinalIgnoreCase)) { Fail 'MODEL_SWITCHER_SUPERVISOR_EXE_MISMATCH' }
  if ($proxy -and $supervisor -and $proxy.parentPid -ne $supervisor.pid) {
    Fail 'MODEL_SWITCHER_PARENT_MISMATCH'
  }
  $other8081 = @(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -ne '127.0.0.1' } |
    Select-Object LocalAddress,OwningProcess -Unique |
    ForEach-Object { [pscustomobject]@{ address = [string]$_.LocalAddress; pid = [int]$_.OwningProcess } })
  $inventory.modelSwitcher = [ordered]@{
    loopbackProxyPid = $proxyPid
    loopbackProxySessionId = if ($proxy) { $proxy.sessionId } else { $null }
    loopbackProxyCreatedAt = if ($proxy) { $proxy.createdAt } else { $null }
    loopbackProxyExecutablePath = if ($proxy) { $proxy.executablePath } else { $null }
    loopbackProxyOwner = if ($proxy) { $proxy.owner } else { $null }
    loopbackProxyFullArgv = if ($proxyArgsMatch) { $proxyArgs } else { $null }
    loopbackProxyArgvMatchesCurrentLauncher = [bool]$proxyArgsMatch
    supervisorPid = $supervisorPid
    supervisorParentPid = if ($supervisor) { $supervisor.parentPid } else { $null }
    supervisorSessionId = if ($supervisor) { $supervisor.sessionId } else { $null }
    supervisorCreatedAt = if ($supervisor) { $supervisor.createdAt } else { $null }
    supervisorExecutablePath = if ($supervisor) { $supervisor.executablePath } else { $null }
    supervisorOwner = if ($supervisor) { $supervisor.owner } else { $null }
    supervisorFullArgv = if ($supervisorArgsMatch) { $supervisorArgs } else { $null }
    supervisorArgvMatchesCurrentLauncher = [bool]$supervisorArgsMatch
    automaticProxyRestartSeconds = 3
    other8081Listeners = $other8081
  }
  $inventory.registeredTasks = @(
    (Task-Facts 'ModelSwitcher-A-Logon' '\'),
    (Task-Facts 'UnifiedModelGateway-StartAll' '\AI\')
  )
  $supervisorParent = if ($supervisor) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $($supervisor.parentPid)" -ErrorAction SilentlyContinue
  } else { $null }
  $inventory.modelSwitcher.supervisorParent = if ($supervisorParent) {
    [ordered]@{ pid = [int]$supervisorParent.ProcessId;
      name = [string]$supervisorParent.Name; sessionId = [int]$supervisorParent.SessionId }
  } else { $null }
} catch {
  Fail 'INVENTORY_EXCEPTION'
} finally {
  $inventory.failures = $failures.ToArray()
  $inventory.readyForReview = $failures.Count -eq 0
  $inventory | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outputFile -Encoding UTF8
  Write-Output ("inventoryFile={0} readyForReview={1} failureCount={2}" -f $outputFile,
    $inventory.readyForReview, $failures.Count)
  if ($failures.Count -ne 0) { exit 2 }
}
