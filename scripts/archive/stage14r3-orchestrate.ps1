# Reviewed Stage14R3 maintenance window. Default is read-only Plan; -Run is
# intentionally separate and may only be invoked by the main assistant.
param(
  [string]$Manifest,
  [string]$ManifestSha256,
  [switch]$Run,
  [switch]$PreflightOnly,
  [switch]$RecoverOnly,
  [switch]$ExplainPlan,
  [switch]$SelfTest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function File-Hash([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function LoopbackListener([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -Unique OwningProcess)
}
function ActiveConnections([int]$port) {
  return @(Get-NetTCPConnection -State Established -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count
}
function Wait-QuietConnections([int]$maxSeconds) {
  $until = (Get-Date).AddSeconds($maxSeconds)
  do {
    if ((ActiveConnections 8080) -eq 0 -and (ActiveConnections 8081) -eq 0) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $until)
  return $false
}
function Process-Identity([int]$processId, [string]$createdAt, [string[]]$argv, [object]$owner) {
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $entry -or -not $entry.CommandLine -or -not $entry.ExecutablePath -or
      [int]$entry.SessionId -ne 0 -or
      -not [string]::Equals([string]$entry.ExecutablePath, $argv[0], [StringComparison]::OrdinalIgnoreCase) -or
      ([datetime]$entry.CreationDate) -ne ([datetime]$createdAt)) { return $false }
  $who = Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction SilentlyContinue
  if ($who.ReturnValue -ne 0 -or
      -not [string]::Equals([string]$who.User, [string]$owner.user, [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$who.Domain, [string]$owner.domain, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $parsed = [WeftMateR3Argv]::Parse([string]$entry.CommandLine)
  if ($parsed.Count -ne $argv.Count) { return $false }
  for ($index = 0; $index -lt $argv.Count; $index++) {
    $comparison = if ($index -lt 2) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals($parsed[$index], $argv[$index], $comparison)) { return $false }
  }
  return $true
}
function Explain-ProcessIdentity([int]$processId, [string]$createdAt, [string[]]$argv, [object]$owner) {
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $entry) { return [ordered]@{ present = $false } }
  $who = Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction SilentlyContinue
  $actualArgv = try { [WeftMateR3Argv]::Parse([string]$entry.CommandLine) } catch { @() }
  $argvMatch = $actualArgv.Count -eq $argv.Count
  $mismatchIndex = $null
  if ($argvMatch) {
    for ($index = 0; $index -lt $argv.Count; $index++) {
      $comparison = if ($index -lt 2) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
      if (-not [string]::Equals($actualArgv[$index], $argv[$index], $comparison)) {
        $argvMatch = $false; $mismatchIndex = $index; break
      }
    }
  }
  return [ordered]@{
    present = $true
    sessionZero = [int]$entry.SessionId -eq 0
    exeMatch = [string]::Equals([string]$entry.ExecutablePath, $argv[0], [StringComparison]::OrdinalIgnoreCase)
    createdMatch = ([datetime]$entry.CreationDate).ToUniversalTime().Ticks -eq
      ([datetime]$createdAt).ToUniversalTime().Ticks
    ownerMatch = $who.ReturnValue -eq 0 -and
      [string]::Equals([string]$who.User, [string]$owner.user, [StringComparison]::OrdinalIgnoreCase) -and
      [string]::Equals([string]$who.Domain, [string]$owner.domain, [StringComparison]::OrdinalIgnoreCase)
    argvCountMatch = $actualArgv.Count -eq $argv.Count
    argvMatch = $argvMatch
    argvMismatchIndex = $mismatchIndex
  }
}
function Status-Idle([int]$expectedPid) {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY', 'User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY', 'Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { throw 'MODEL_SWITCHER_KEY_UNAVAILABLE' }
  $state = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 -DisableKeepAlive `
    -Headers @{ Authorization = "Bearer $key" }
  return $state.currentModelId -eq 'qwen3.8-27b' -and $state.probe.health -eq $true -and
    [int]$state.state.pid -eq $expectedPid -and $state.switching -eq $false -and
    [int]$state.activeLeases -eq 0 -and [int]$state.queuedLeases -eq 0 -and
    [int]$state.maintenanceQueued -eq 0
}
function Test-IdleLogLines([string[]]$lines) {
  $lastThroughput = -1
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match 'throughput interval=') { $lastThroughput = $index }
  }
  if ($lastThroughput -lt 0 -or $lines[$lastThroughput] -notmatch '\brunning=0\b') { return $false }
  for ($index = $lastThroughput + 1; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match '(?:\bsubmitted\b|\brunning=[1-9]\d*\b)') { return $false }
  }
  return $true
}
function RecentNinferIdle {
  $log = 'D:\AI\Runtime\Logs\qwen3.8-27b-ninfer.server.err.log'
  return Test-IdleLogLines @(Get-Content -LiteralPath $log -Tail 200 -Encoding UTF8 -ErrorAction Stop)
}
function Wait-NinferQuiescent([int]$maxSeconds) {
  $until = (Get-Date).AddSeconds($maxSeconds)
  do {
    if ((ActiveConnections 8080) -eq 0 -and (RecentNinferIdle)) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $until)
  return $false
}
function Stop-Exact([int]$processId, [string]$createdAt, [string[]]$argv, [object]$owner,
  [object]$attempted = $null) {
  if (-not (Process-Identity $processId $createdAt $argv $owner)) { throw 'PROCESS_IDENTITY_CHANGED' }
  if ($attempted -is [System.Management.Automation.PSReference]) { $attempted.Value = $true }
  Stop-Process -Id $processId -Force -ErrorAction Stop
  $until = (Get-Date).AddSeconds(15)
  while ((Get-Process -Id $processId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) {
    Start-Sleep -Milliseconds 200
  }
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw 'PROCESS_STOP_UNCONFIRMED' }
}
function Worker-TaskDefinition([string]$action, [string]$nonce) {
  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $worker = Join-Path $PSScriptRoot 'stage14r3-worker.ps1'
  $workerStatus = Join-Path $plan.acceptanceRoot "worker-status-$action-$($plan.runId)-$nonce.json"
  $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden' +
    ' -File "' + $worker + '" -Action ' + $action +
    ' -Manifest "' + $Manifest + '" -ManifestSha256 ' + $ManifestSha256 +
    ' -StatusFile "' + $workerStatus + '" -Nonce ' + $nonce
  return [pscustomobject]@{ execute = $powerShell; arguments = $arguments;
    workingDirectory = $PSScriptRoot;
    principalUser = "$($plan.original.owner.domain)\$($plan.original.owner.user)" }
}
function Principal-SidMatches([string]$userId, [string]$expectedSid) {
  try {
    $resolved = (New-Object Security.Principal.NTAccount($userId)).Translate(
      [Security.Principal.SecurityIdentifier]).Value
    return [string]::Equals($resolved, $expectedSid, [StringComparison]::Ordinal)
  } catch { return $false }
}
function Register-Worker([string]$action, [string]$taskName, [string]$nonce) {
  if (Get-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -ErrorAction SilentlyContinue) {
    throw 'TEMP_TASK_ALREADY_EXISTS'
  }
  $definition = Worker-TaskDefinition $action $nonce
  $taskAction = New-ScheduledTaskAction -Execute $definition.execute -Argument $definition.arguments `
    -WorkingDirectory $PSScriptRoot
  $principal = New-ScheduledTaskPrincipal -UserId $definition.principalUser `
    -LogonType S4U -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew -RestartCount 0
  Register-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -Action $taskAction `
    -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
}
function Assert-WorkerTask([string]$action, [string]$taskName, [string]$nonce) {
  if ($plan.workerSha256 -ne (File-Hash (Join-Path $PSScriptRoot 'stage14r3-worker.ps1'))) {
    throw 'OWNED_WORKER_HASH_CHANGED'
  }
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -ErrorAction SilentlyContinue
  if ($null -eq $task) { return $false }
  $definition = Worker-TaskDefinition $action $nonce
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or [string]$task.State -eq 'Running' -or
      -not (Principal-SidMatches ([string]$task.Principal.UserId) ([string]$plan.requiredToken.sid)) -or
      [string]$task.Principal.LogonType -ne 'S4U' -or
      [string]$task.Principal.RunLevel -ne 'Limited' -or
      -not [string]::Equals([string]$actions[0].Execute, $definition.execute,
        [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$actions[0].Arguments, $definition.arguments,
        [StringComparison]::Ordinal) -or
      -not [string]::Equals([string]$actions[0].WorkingDirectory, $definition.workingDirectory,
        [StringComparison]::OrdinalIgnoreCase)) { throw 'OWNED_TASK_DEFINITION_CHANGED' }
  return $true
}
function Wait-Worker([string]$file, [string]$action, [string]$nonce,
  [string]$taskName, [datetime]$triggerAt, [int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  $statusFile = Join-Path $plan.acceptanceRoot "worker-status-$action-$($plan.runId)-$nonce.json"
  do {
    if (Test-Path -LiteralPath $statusFile) {
      $status = Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($status.runId -eq $plan.runId -and $status.nonce -eq $nonce -and
          $status.action -eq $action -and $status.phase -eq 'failed') { throw 'WORKER_REPORTED_FAILURE' }
    }
    if (Test-Path -LiteralPath $file) {
      $result = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
      $token = $result.token
      if ($result.runId -eq $plan.runId -and $result.nonce -eq $nonce -and
          $result.action -eq $action -and $result.ready -eq $true -and
          $token.sid -eq $plan.requiredToken.sid -and
          [int]$token.sessionId -eq [int]$plan.requiredToken.sessionId -and
          $token.elevationType -eq $plan.requiredToken.elevationType -and
          $token.integritySid -eq $plan.requiredToken.integritySid) {
        $info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\AI\' -ErrorAction Stop
        $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\AI\' -ErrorAction Stop
        if ($info.LastRunTime -ge $triggerAt.AddSeconds(-2) -and
            [int]$info.LastTaskResult -eq 0 -and [string]$task.State -ne 'Running') { return $result }
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $until)
  throw 'WORKER_TIMEOUT'
}
function Run-Micro([string]$mode) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $script = Join-Path $PSScriptRoot 'stage14r3-ninfer-micro.mjs'
  $out = Join-Path $plan.acceptanceRoot "micro-$mode-$($plan.runId).json"
  $stdout = Join-Path $plan.acceptanceRoot "micro-$mode-$($plan.runId).stdout.log"
  $stderr = Join-Path $plan.acceptanceRoot "micro-$mode-$($plan.runId).stderr.log"
  if (Test-Path -LiteralPath $out) { throw 'MICRO_ALREADY_RUN' }
  $env:WEFTMATE_STAGE14R3_MICRO = '1'
  try {
    $process = Start-Process -FilePath $node `
      -ArgumentList @($script, '--run', '--mode', $mode, '--output', $out) `
      -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $out)) { throw 'MICRO_FAILED' }
    $result = Get-Content -LiteralPath $out -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($result.scope -ne 'micro_only' -or $result.mode -ne $mode -or $result.status -ne 'finished') {
      throw 'MICRO_UNCONFIRMED'
    }
    return $result
  } finally { Remove-Item Env:\WEFTMATE_STAGE14R3_MICRO -ErrorAction SilentlyContinue }
}
function Require-Budget([int]$minimumSeconds) {
  if ($null -ne $script:maintenanceDeadline -and
      ($script:maintenanceDeadline - (Get-Date)).TotalSeconds -lt $minimumSeconds) {
    throw 'MAINTENANCE_TIME_BUDGET'
  }
}
function Restore-State([int]$restoredPid) {
  $stateFile = 'D:\AI\Control\State\ModelSwitcher\current.json'
  $current = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($current.dshModelId -ne 'qwen3.8-27b' -or
      ([int]$current.pid -ne [int]$plan.original.pid -and [int]$current.pid -ne $restoredPid)) {
    throw 'MODEL_SWITCHER_STATE_CHANGED'
  }
  if ($restoredPid -eq [int]$plan.original.pid -and
      (File-Hash $stateFile) -eq $plan.currentStateSha256) { return }
  if ([int]$current.pid -eq $restoredPid -and $restoredPid -ne [int]$plan.original.pid) { return }
  if ((File-Hash $stateFile) -ne $plan.currentStateSha256) { throw 'MODEL_SWITCHER_STATE_BYTES_CHANGED' }
  $current.pid = $restoredPid
  $current.outcome = 'stage14r3-restored'
  $current.switchedAt = (Get-Date).ToString('o')
  $current.elapsedSeconds = 0
  $current.switcherPid = $PID
  $temporary = "$stateFile.$($plan.runId).tmp"
  $backup = Join-Path $plan.acceptanceRoot "current-before-stage14r3-$($plan.runId).json"
  if (Test-Path -LiteralPath $backup) { throw 'STATE_BACKUP_ALREADY_EXISTS' }
  try {
    $current | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporary -Encoding UTF8
    [IO.File]::Replace($temporary, $stateFile, $backup)
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  if ([int](Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json).pid -ne $restoredPid) {
    throw 'STATE_PID_WRITE_UNCONFIRMED'
  }
}
function Finalize-Recovery([int]$restoredPid) {
  $listener = @(LoopbackListener 8080)
  if ($listener.Count -ne 1 -or [int]$listener[0].OwningProcess -ne $restoredPid) {
    throw 'RESTORED_NINFER_LISTENER_UNCONFIRMED'
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $restoredPid" -ErrorAction Stop
  $restoredCreated = ([datetime]$process.CreationDate).ToString('o')
  if ([datetime]$process.CreationDate -lt [datetime]$plan.original.createdAt -or
      -not (Process-Identity $restoredPid $restoredCreated @($plan.original.argv) $plan.original.owner)) {
    throw 'RESTORED_NINFER_IDENTITY_UNCONFIRMED'
  }
  if (@(LoopbackListener 8081).Count -ne 0 -or (ActiveConnections 8080) -ne 0) {
    throw 'RECOVERY_INGRESS_NOT_FENCED'
  }
  $registeredTask = Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  if ([string]$registeredTask.Principal.UserId -ne [string]$plan.switcher.principalUserId -or
      [string]$registeredTask.Principal.LogonType -ne 'S4U' -or
      [string]$registeredTask.Principal.RunLevel -ne 'Limited') { throw 'ORIGINAL_TASK_CHANGED' }
  $actions = @($registeredTask.Actions)
  if ($actions.Count -ne 1 -or
      -not [string]::Equals([string]$actions[0].Execute,
        [string]$plan.switcher.registeredTaskAction.execute, [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$actions[0].Arguments,
        [string]$plan.switcher.registeredTaskAction.arguments, [StringComparison]::Ordinal) -or
      -not [string]::Equals([string]$actions[0].WorkingDirectory,
        [string]$plan.switcher.registeredTaskAction.workingDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ORIGINAL_TASK_ACTION_CHANGED'
  }
  Restore-State $restoredPid
  Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $proxy = @(LoopbackListener 8081)
    if ($proxy.Count -eq 1 -and (Status-Idle $restoredPid)) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  if ($proxy.Count -ne 1 -or -not (Status-Idle $restoredPid)) { throw 'RESTORED_SWITCHER_STATUS_UNCONFIRMED' }
  $proxyPid = [int]$proxy[0].OwningProcess
  $proxyProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $proxyPid" -ErrorAction Stop
  $proxyCreated = ([datetime]$proxyProcess.CreationDate).ToString('o')
  if ([datetime]$proxyProcess.CreationDate -lt [datetime]$plan.acceptedAt -or
      -not (Process-Identity $proxyPid $proxyCreated @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner)) {
    throw 'RESTORED_PROXY_IDENTITY_UNCONFIRMED'
  }
  $switcherState = Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $supervisorPid = [int]$switcherState.supervisorPid
  $supervisorProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorPid" -ErrorAction Stop
  $supervisorCreated = ([datetime]$supervisorProcess.CreationDate).ToString('o')
  if ([datetime]$supervisorProcess.CreationDate -lt [datetime]$plan.acceptedAt -or
      -not (Process-Identity $supervisorPid $supervisorCreated @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner)) {
    throw 'RESTORED_SUPERVISOR_IDENTITY_UNCONFIRMED'
  }
  $reportPath = Join-Path $plan.acceptanceRoot "recovery-$($plan.runId)-$runNonce.json"
  [ordered]@{ schemaVersion = 1; runId = $plan.runId; nonce = $runNonce; ready = $true;
    restoredPid = $restoredPid; proxyPid = $proxyPid; supervisorPid = $supervisorPid;
    at = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $reportPath -Encoding UTF8
  return $reportPath
}
function Trial-Report {
  if ($script:trialNonce -notmatch '^[0-9a-f]{32}$') { throw 'TRIAL_NONCE_MISSING' }
  $path = Join-Path $plan.acceptanceRoot "trial-$($plan.runId)-$script:trialNonce.json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'TRIAL_REPORT_MISSING' }
  $report = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $token = $report.token
  if ($report.runId -ne $plan.runId -or $report.action -ne 'Trial' -or
      $report.nonce -ne $script:trialNonce -or
      -not [int]$report.pid -or -not $report.processCreatedAt -or
      $token.sid -ne $plan.requiredToken.sid -or
      [int]$token.sessionId -ne [int]$plan.requiredToken.sessionId -or
      $token.elevationType -ne $plan.requiredToken.elevationType -or
      $token.integritySid -ne $plan.requiredToken.integritySid) { throw 'TRIAL_REPORT_IDENTITY_MISMATCH' }
  return $report
}
function Restore-Report {
  if ($script:initialRecoverNonce -notmatch '^[0-9a-f]{32}$') { throw 'RESTORE_NONCE_MISSING' }
  $path = Join-Path $plan.acceptanceRoot "restore-$($plan.runId)-$script:initialRecoverNonce.json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'RESTORE_REPORT_MISSING' }
  $report = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  $token = $report.token
  if ($report.runId -ne $plan.runId -or $report.action -ne 'Recover' -or
      $report.nonce -ne $script:initialRecoverNonce -or
      -not [int]$report.pid -or -not $report.processCreatedAt -or
      $token.sid -ne $plan.requiredToken.sid -or
      [int]$token.sessionId -ne [int]$plan.requiredToken.sessionId -or
      $token.elevationType -ne $plan.requiredToken.elevationType -or
      $token.integritySid -ne $plan.requiredToken.integritySid) { throw 'RESTORE_REPORT_IDENTITY_MISMATCH' }
  return $report
}
function Recover-AfterStop([string]$recoverTask, [string]$recoverNonce) {
  # A controller failure may leave a known process alive without a listener.
  # Inspect every exact NInfer executable in this model's narrow process set
  # before starting another copy; unknown identities are never terminated.
  $oldSupervisor = Process-Identity ([int]$plan.switcher.supervisorPid) `
    $plan.switcher.supervisorCreatedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner
  $oldProxy = Process-Identity ([int]$plan.switcher.proxyPid) `
    $plan.switcher.proxyCreatedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner
  $oldModel = Process-Identity ([int]$plan.original.pid) `
    $plan.original.createdAt @($plan.original.argv) $plan.original.owner
  $supervisorScript = [string]$plan.switcher.supervisorArgv[-1]
  $supervisors = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and
      ([string]$_.CommandLine).IndexOf($supervisorScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  if (@($supervisors | Where-Object { [int]$_.ProcessId -ne [int]$plan.switcher.supervisorPid -or
      -not $oldSupervisor }).Count -ne 0) { throw 'UNKNOWN_SUPERVISOR_DURING_RECOVERY' }
  $allNinfer = @(Get-CimInstance Win32_Process -Filter "Name = 'ninfer-serve.exe'" -ErrorAction Stop)
  if ($allNinfer.Count -eq 0 -and $oldModel) { throw 'NINFER_PROCESS_VIEW_INCONSISTENT' }
  if (@($allNinfer | Where-Object { -not $_.ExecutablePath -or
      -not [string]::Equals([string]$_.ExecutablePath, [string]$plan.original.exe,
        [StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) {
    throw 'UNKNOWN_NINFER_EXE_DURING_RECOVERY'
  }
  if ($oldSupervisor -and $oldProxy -and $oldModel -and
      $allNinfer.Count -eq 1 -and [int]$allNinfer[0].ProcessId -eq [int]$plan.original.pid -and
      (Status-Idle ([int]$plan.original.pid))) {
    return [int]$plan.original.pid
  }
  if ($oldSupervisor) {
    Stop-Exact ([int]$plan.switcher.supervisorPid) $plan.switcher.supervisorCreatedAt `
      @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner
  }
  $remainingProxy = @(LoopbackListener 8081)
  if ($remainingProxy.Count -eq 1 -and
      [int]$remainingProxy[0].OwningProcess -eq [int]$plan.switcher.proxyPid) {
    Stop-Exact ([int]$plan.switcher.proxyPid) $plan.switcher.proxyCreatedAt `
      @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner
  } elseif ($remainingProxy.Count -ne 0) { throw 'UNKNOWN_PROXY_DURING_RECOVERY' }
  $restoredPid = 0
  foreach ($entry in $allNinfer) {
    $currentPid = [int]$entry.ProcessId
    if ($currentPid -eq [int]$plan.original.pid -and
        (Process-Identity $currentPid $plan.original.createdAt @($plan.original.argv) $plan.original.owner)) {
      $listeners = @(LoopbackListener 8080)
      if ($listeners.Count -eq 1 -and [int]$listeners[0].OwningProcess -eq $currentPid) {
        $restoredPid = $currentPid
      } else {
        Stop-Exact $currentPid $plan.original.createdAt @($plan.original.argv) $plan.original.owner
      }
      continue
    }
    $createdAt = ([datetime]$entry.CreationDate).ToString('o')
    $restorePath = Join-Path $plan.acceptanceRoot "restore-$($plan.runId)-$script:initialRecoverNonce.json"
    if (Test-Path -LiteralPath $restorePath) {
      $restoreReport = Restore-Report
      if ($currentPid -eq [int]$restoreReport.pid -and
          ([datetime]$createdAt).ToUniversalTime().Ticks -eq
            ([datetime]$restoreReport.processCreatedAt).ToUniversalTime().Ticks -and
          (Process-Identity $currentPid $createdAt @($plan.original.argv) $plan.original.owner)) {
        $listeners = @(LoopbackListener 8080)
        if ($listeners.Count -eq 1 -and [int]$listeners[0].OwningProcess -eq $currentPid) {
          $restoredPid = $currentPid
        } else {
          Stop-Exact $currentPid $createdAt @($plan.original.argv) $plan.original.owner
        }
        continue
      }
    }
    $trialReport = Trial-Report
    if ($currentPid -ne [int]$trialReport.pid -or
        ([datetime]$createdAt).ToUniversalTime().Ticks -ne
          ([datetime]$trialReport.processCreatedAt).ToUniversalTime().Ticks -or
        [datetime]$entry.CreationDate -lt [datetime]$plan.acceptedAt -or
        -not (Process-Identity $currentPid $createdAt @($plan.trial.argv) $plan.original.owner)) {
      throw 'UNKNOWN_NINFER_PROCESS_DURING_RECOVERY'
    }
    Stop-Exact $currentPid $createdAt @($plan.trial.argv) $plan.original.owner
  }
  $listeners = @(LoopbackListener 8080)
  if ($restoredPid -eq 0) {
    if ($listeners.Count -ne 0 -or (ActiveConnections 8080) -ne 0) { throw 'RESTORE_PORT_NOT_FREE' }
    $recoverTriggeredAt = Get-Date
    Start-ScheduledTask -TaskName $recoverTask -TaskPath '\AI\' -ErrorAction Stop
    $restoredState = Wait-Worker (Join-Path $plan.acceptanceRoot "restore-$($plan.runId)-$recoverNonce.json") `
      'Recover' $recoverNonce $recoverTask $recoverTriggeredAt 175
    $restoredPid = [int]$restoredState.pid
  } elseif ($listeners.Count -ne 1 -or [int]$listeners[0].OwningProcess -ne $restoredPid) {
    throw 'ORIGINAL_LISTENER_CHANGED_DURING_RECOVERY'
  }
  [void](Finalize-Recovery $restoredPid)
  return $restoredPid
}

$argvSource = @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Collections.Generic;
public static class WeftMateR3Argv {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  private static extern IntPtr CommandLineToArgvW(string line, out int count);
  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr pointer);
  public static string[] Parse(string line) {
    int count; IntPtr values = CommandLineToArgvW(line, out count);
    if (values == IntPtr.Zero || count < 1 || count > 64) throw new InvalidOperationException();
    try { string[] output = new string[count];
      for (int i=0;i<count;i++) output[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(values,i*IntPtr.Size));
      return output; } finally { LocalFree(values); }
  }
}
public static class WeftMateR3TokenFacts {
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)]
  private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)]
  private static extern bool GetTokenInformation(IntPtr token, int infoClass,
    IntPtr output, int length, out int needed);
  private static string Elevation(IntPtr token) {
    IntPtr buffer = Marshal.AllocHGlobal(4);
    try { int needed;
      if (!GetTokenInformation(token, 18, buffer, 4, out needed)) return "unknown";
      switch (Marshal.ReadInt32(buffer)) { case 1: return "Default";
        case 2: return "Full"; case 3: return "Limited";
        default: return "unknown"; }
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  private static string Integrity(IntPtr token) {
    int needed; GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
    if (needed < IntPtr.Size || needed > 4096) return "unknown";
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return "unknown";
      return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
    } catch { return "unknown"; }
    finally { Marshal.FreeHGlobal(buffer); }
  }
  public static IDictionary<string,object> Read(uint pid) {
    var facts = new Dictionary<string,object>();
    facts["pid"] = pid; facts["available"] = false;
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) { facts["openError"] = Marshal.GetLastWin32Error(); return facts; }
    try {
      IntPtr token;
      if (!OpenProcessToken(process, 0x0008, out token)) {
        facts["tokenError"] = Marshal.GetLastWin32Error(); return facts;
      }
      try {
        using (var identity = new WindowsIdentity(token)) {
          facts["sid"] = identity.User == null ? null : identity.User.Value;
          facts["name"] = identity.Name;
          try { facts["adminRole"] = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); }
          catch { facts["adminRole"] = null; }
          facts["elevationType"] = Elevation(token);
          facts["integritySid"] = Integrity(token);
          facts["available"] = true;
        }
      } finally { CloseHandle(token); }
    } catch { facts["available"] = false; facts["tokenError"] = -1; }
    finally { CloseHandle(process); }
    return facts;
  }
}
'@
Add-Type -TypeDefinition $argvSource
if ($SelfTest) {
  $selfSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not (Principal-SidMatches $env:USERNAME $selfSid) -or
      (Principal-SidMatches $env:USERNAME 'S-1-5-21-0-0-0-9999')) {
    throw 'TASK_PRINCIPAL_SID_TEST_FAILED'
  }
  if (-not (Test-IdleLogLines @('[2026-10-04 00:00:00] throughput interval=5.0s running=0')) -or
      (Test-IdleLogLines @('[2026-10-04 00:00:00] throughput interval=5.0s running=0',
        '[2026-10-04 01:00:00] [req 8] submitted')) -or
      (Test-IdleLogLines @('[2026-10-04 00:00:00] throughput interval=5.0s running=1'))) {
    throw 'IDLE_LOG_GATE_FAILED'
  }
  $script:fakeEstablished = 2
  function ActiveConnections { if ($script:fakeEstablished -gt 0) {
    $script:fakeEstablished--; return 1
  }; return 0 }
  if (-not (Wait-QuietConnections 1)) { throw 'OWN_PROBE_DRAIN_FAILED' }
  function ActiveConnections { return 1 }
  if (Wait-QuietConnections 0) { throw 'UNRELATED_CLIENT_EXEMPTED' }
  $script:trace = New-Object 'System.Collections.Generic.List[string]'
  function Process-Identity { return $false }
  function Stop-Process { $script:trace.Add('UNEXPECTED_REAL_STOP') }
  $attempted = $false
  try { Stop-Exact 101 '2026-10-04T00:00:00Z' @('fake.exe') @{} ([ref]$attempted); throw 'CHANGED_PID_ACCEPTED' }
  catch { if ($_.Exception.Message -ne 'PROCESS_IDENTITY_CHANGED' -or $script:trace.Count -ne 0 -or $attempted) { throw } }
  try { Stop-Exact 101 '2026-10-04T00:00:00Z' @('fake.exe') @{}; throw 'OMITTED_REF_ACCEPTED' }
  catch { if ($_.Exception.Message -ne 'PROCESS_IDENTITY_CHANGED' -or $script:trace.Count -ne 0) { throw } }
  function Process-Identity { return $true }
  function Stop-Process { throw 'SYNTHETIC_STOP_CONFIRMATION_FAILED' }
  try { Stop-Exact 101 '2026-10-04T00:00:00Z' @('fake.exe') @{} ([ref]$attempted); throw 'STOP_FAILURE_ACCEPTED' }
  catch { if ($_.Exception.Message -ne 'SYNTHETIC_STOP_CONFIRMATION_FAILED' -or -not $attempted) { throw } }
  $attempted = $false
  $plan = [pscustomobject]@{
    runId = '11111111-2222-3333-4444-555555555555'
    acceptedAt = '2026-10-04T00:00:00Z'
    acceptanceRoot = 'C:\\synthetic-only'
    original = [pscustomobject]@{ pid = 101; createdAt = '2026-10-01T00:00:00Z';
      argv = @('C:\\ninfer.exe', 'C:\\model.ninfer'); owner = [pscustomobject]@{};
      exe = 'C:\\ninfer.exe' }
    trial = [pscustomobject]@{ argv = @('C:\\ninfer.exe', 'C:\\model.ninfer') }
    requiredToken = [pscustomobject]@{ sid = 'S-1-5-21-1-2-3-1000';
      sessionId = 0; elevationType = 'Default'; integritySid = 'S-1-16-12288' }
    switcher = [pscustomobject]@{ supervisorPid = 102; supervisorCreatedAt = '2026-10-01T00:00:00Z';
      supervisorArgv = @('supervisor.exe'); supervisorOwner = [pscustomobject]@{};
      proxyPid = 103; proxyCreatedAt = '2026-10-01T00:00:00Z';
      proxyArgv = @('proxy.exe'); proxyOwner = [pscustomobject]@{} }
  }
  $script:fakePid = 101
  $script:initialRecoverNonce = 'd' * 32
  $script:fakeSupervisorUnknown = $false
  function Get-CimInstance {
    param($ClassName, $Filter)
    if ($Filter -match 'powershell' -and $script:fakeSupervisorUnknown) {
      return [pscustomobject]@{ ProcessId = 999; ExecutablePath = 'C:\\powershell.exe';
        CommandLine = 'C:\\supervisor.exe'; CreationDate = '2026-10-04T00:00:01Z' }
    }
    return [pscustomobject]@{
    ProcessId = $script:fakePid; ExecutablePath = 'C:\\ninfer.exe';
    CommandLine = ''; CreationDate = '2026-10-04T00:00:01Z' }
  }
  function LoopbackListener { return @() }
  function ActiveConnections { return 0 }
  function Status-Idle { return $true }
  function Stop-Exact { $script:trace.Add('stop:303') }
  function Start-ScheduledTask { $script:trace.Add('start:recover') }
  function Wait-Worker { return [pscustomobject]@{ pid = 404 } }
  function Finalize-Recovery { $script:trace.Add('finalize:404') }
  function Process-Identity { return $true }
  $result = Recover-AfterStop 'fake-task' ('a' * 32)
  if ($result -ne 101 -or $script:trace.Count -ne 0) { throw 'INTACT_STATE_CHANGED' }
  $script:fakePid = 303
  function Trial-Report { return [pscustomobject]@{ pid = 303;
    processCreatedAt = '2026-10-04T00:00:01.0000000Z' } }
  function Process-Identity { param($processId) return $processId -eq 303 }
  $result = Recover-AfterStop 'fake-task' ('a' * 32)
  if ($result -ne 404 -or ($script:trace -join ',') -ne 'stop:303,start:recover,finalize:404') {
    throw 'RECOVERY_BRANCH_FAILED'
  }
  $script:trace.Clear()
  function Process-Identity { return $false }
  try { [void](Recover-AfterStop 'fake-task' ('b' * 32)); throw 'UNKNOWN_PID_ACCEPTED' }
  catch {
    if ($_.Exception.Message -ne 'UNKNOWN_NINFER_PROCESS_DURING_RECOVERY' -or $script:trace.Count -ne 0) { throw }
  }
  $script:fakeSupervisorUnknown = $true
  try { [void](Recover-AfterStop 'fake-task' ('c' * 32)); throw 'UNKNOWN_SUPERVISOR_ACCEPTED' }
  catch {
    if ($_.Exception.Message -ne 'UNKNOWN_SUPERVISOR_DURING_RECOVERY' -or $script:trace.Count -ne 0) { throw }
  }
  $script:fakeSupervisorUnknown = $false
  $script:fakePid = 505
  $plan.acceptanceRoot = [IO.Path]::GetTempPath()
  $restorePath = Join-Path $plan.acceptanceRoot "restore-$($plan.runId)-$script:initialRecoverNonce.json"
  try {
    [ordered]@{ runId = $plan.runId; action = 'Recover'; nonce = $script:initialRecoverNonce;
      pid = 505; processCreatedAt = '2026-10-04T00:00:01Z';
      token = $plan.requiredToken } | ConvertTo-Json -Depth 4 |
      Set-Content -LiteralPath $restorePath -Encoding UTF8
    function Process-Identity { param($processId) return $processId -eq 505 }
    function LoopbackListener { param($port) if ($port -eq 8080) {
      return [pscustomobject]@{ OwningProcess = 505 }
    } else { return @() } }
    function Finalize-Recovery { $script:trace.Add('finalize:505') }
    $restoreProof = Restore-Report
    if ([int]$restoreProof.pid -ne 505 -or
        ([datetime]$restoreProof.processCreatedAt).ToUniversalTime().Ticks -ne
          ([datetime]'2026-10-04T00:00:01Z').ToUniversalTime().Ticks) {
      throw 'SYNTHETIC_RESTORE_REPORT_INVALID'
    }
    $result = Recover-AfterStop 'fake-task' ('e' * 32)
    if ($result -ne 505 -or ($script:trace -join ',') -ne 'finalize:505') {
      throw 'EARLY_RESTORE_REPORT_NOT_REUSED'
    }
  } finally { Remove-Item -LiteralPath $restorePath -Force -ErrorAction SilentlyContinue }
  Write-Output 'stage14r3-orchestrate-selftest=passed'
  exit 0
}
if (-not $Manifest -or $ManifestSha256 -notmatch '^[a-f0-9]{64}$' -or
    -not (Test-Path -LiteralPath $Manifest -PathType Leaf) -or (File-Hash $Manifest) -ne $ManifestSha256) {
  throw 'MANIFEST_INVALID'
}
$plan = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.schemaVersion -ne 1 -or $plan.purpose -ne 'stage14r3-ephemeral-ninfer-maintenance' -or
    $plan.readyForExecution -ne $false -or
    $plan.orchestratorSha256 -ne (File-Hash $MyInvocation.MyCommand.Path) -or
    $plan.expectedConfigSha256 -ne (File-Hash 'D:\AI\Config\qwen3.8-27b-ninfer.json') -or
    $plan.workerSha256 -ne (File-Hash (Join-Path $PSScriptRoot 'stage14r3-worker.ps1')) -or
    $plan.benchmarkSha256 -ne (File-Hash (Join-Path $PSScriptRoot 'stage14r3-ninfer-micro.mjs'))) {
  throw 'PLAN_HASH_MISMATCH'
}
$admin = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
$selectedModes = @(@($Run, $PreflightOnly, $RecoverOnly, $ExplainPlan) | Where-Object { $_ })
if ($selectedModes.Count -gt 1) {
  throw 'MAINTENANCE_MODE_CONFLICT'
}
if ($Run -and $plan.tokenEvidenceProvisional -eq $true) { throw 'TOKEN_EVIDENCE_PROVISIONAL' }
if ($ExplainPlan) {
  $ninferIdentity = try { Explain-ProcessIdentity ([int]$plan.original.pid) `
    $plan.original.createdAt @($plan.original.argv) $plan.original.owner } catch { [ordered]@{ readFailed = $true } }
  $proxyIdentity = try { Explain-ProcessIdentity ([int]$plan.switcher.proxyPid) `
    $plan.switcher.proxyCreatedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner } catch { [ordered]@{ readFailed = $true } }
  $supervisorIdentity = try { Explain-ProcessIdentity ([int]$plan.switcher.supervisorPid) `
    $plan.switcher.supervisorCreatedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner } catch { [ordered]@{ readFailed = $true } }
  $port8080 = @(LoopbackListener 8080)
  $port8081 = @(LoopbackListener 8081)
  $statusIdle = try { Status-Idle ([int]$plan.original.pid) } catch { $false }
  $tcp8080 = ActiveConnections 8080
  $tcp8081 = ActiveConnections 8081
  $logIdle = try { RecentNinferIdle } catch { $false }
  $diagnostic = [ordered]@{ schemaVersion = 1; runId = $plan.runId;
    kind = 'stage14r3-read-only-plan-gates'; at = (Get-Date).ToString('o');
    servicesUntouched = $true; ninferIdentity = $ninferIdentity;
    proxyIdentity = $proxyIdentity; supervisorIdentity = $supervisorIdentity;
    listener8080Count = $port8080.Count;
    listener8080PidMatch = $port8080.Count -eq 1 -and [int]$port8080[0].OwningProcess -eq [int]$plan.original.pid;
    listener8081Count = $port8081.Count;
    listener8081PidMatch = $port8081.Count -eq 1 -and [int]$port8081[0].OwningProcess -eq [int]$plan.switcher.proxyPid;
    statusIdle = $statusIdle; established8080 = $tcp8080;
    established8081 = $tcp8081; ninferLogIdle = $logIdle }
  $path = Join-Path $plan.acceptanceRoot ("plan-gates-$($plan.runId)-$([guid]::NewGuid().ToString('N')).json")
  $diagnostic | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8
  Write-Output ("planGatesFile={0} servicesUntouched=true" -f $path)
  exit 0
}
if ($PreflightOnly) {
  $preflightNonce = [guid]::NewGuid().ToString('N')
  $preflightTask = "WeftMate-Stage14R3-Preflight-$($plan.runId.Substring(0,8))-$($preflightNonce.Substring(0,8))"
  $oldTokenFacts = @(
    [WeftMateR3TokenFacts]::Read([uint32]$plan.original.pid),
    [WeftMateR3TokenFacts]::Read([uint32]$plan.switcher.proxyPid),
    [WeftMateR3TokenFacts]::Read([uint32]$plan.switcher.supervisorPid)
  )
  $controllerReport = Join-Path $plan.acceptanceRoot "preflight-controller-$($plan.runId)-$preflightNonce.json"
  $workerStatusFile = Join-Path $plan.acceptanceRoot "worker-status-Preflight-$($plan.runId)-$preflightNonce.json"
  $phase = 'register'
  $code = 'UNCONFIRMED'
  $lastTaskResult = $null
  $registered = $false
  $passed = $false
  try {
    Register-Worker 'Preflight' $preflightTask $preflightNonce
    $registered = $true
    $phase = 'trigger'
    $triggerAt = Get-Date
    Start-ScheduledTask -TaskName $preflightTask -TaskPath '\AI\' -ErrorAction Stop
    $phase = 'await_worker'
    $reportPath = Join-Path $plan.acceptanceRoot "preflight-$($plan.runId)-$preflightNonce.json"
    [void](Wait-Worker $reportPath 'Preflight' $preflightNonce $preflightTask $triggerAt 40)
    $phase = 'completed'; $code = 'OK'; $passed = $true
  } catch {
    if ($code -eq 'UNCONFIRMED') {
      if (Test-Path -LiteralPath $workerStatusFile) {
        $workerStatus = Get-Content -LiteralPath $workerStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($workerStatus.runId -eq $plan.runId -and $workerStatus.nonce -eq $preflightNonce -and
            $workerStatus.action -eq 'Preflight' -and $workerStatus.phase -eq 'failed' -and
            [string]$workerStatus.code -match '^[A-Z][A-Z0-9_]{3,80}$') {
          $code = [string]$workerStatus.code
        }
      }
      if ($code -eq 'UNCONFIRMED') {
        $code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
          $_.Exception.Message
        } else { 'PREFLIGHT_FAILED' }
      }
    }
  } finally {
    if ($registered) {
      try {
        $info = Get-ScheduledTaskInfo -TaskName $preflightTask -TaskPath '\AI\' -ErrorAction Stop
        $lastTaskResult = [int]$info.LastTaskResult
      } catch { }
      Unregister-ScheduledTask -TaskName $preflightTask -TaskPath '\AI\' -Confirm:$false -ErrorAction SilentlyContinue
    }
    [ordered]@{ schemaVersion = 1; runId = $plan.runId; nonce = $preflightNonce;
      kind = 's4u-preflight-controller';
      phase = $phase; code = $code; passed = $passed;
      taskRegistered = $registered; taskLastResult = $lastTaskResult;
      oldTokens = $oldTokenFacts;
      workerStatusPresent = (Test-Path -LiteralPath $workerStatusFile);
      originalServicesUntouched = $true; at = (Get-Date).ToString('o') } |
      ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $controllerReport -Encoding UTF8
  }
  Write-Output ("preflightControllerFile={0} phase={1} code={2}" -f $controllerReport, $phase, $code)
  if (-not $passed) { exit 2 }
  exit 0
}
if ($RecoverOnly) {
  $runLock = Join-Path $plan.acceptanceRoot "run-lock-$($plan.runId).json"
  if (-not (Test-Path -LiteralPath $runLock -PathType Leaf)) { throw 'RUN_LOCK_MISSING' }
  $locked = Get-Content -LiteralPath $runLock -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($locked.runId -ne $plan.runId -or $locked.manifestSha256 -ne $ManifestSha256) {
    throw 'RUN_LOCK_MISMATCH'
  }
  $badNonces = @(@($locked.preflightNonce, $locked.trialNonce, $locked.recoverNonce) |
    Where-Object { $_ -notmatch '^[0-9a-f]{32}$' })
  if ($locked.workerSha256 -ne $plan.workerSha256 -or $badNonces.Count -ne 0) {
    throw 'RUN_LOCK_TASK_DEFINITION_UNBOUND'
  }
  if ($locked.preflightTaskName -ne "WeftMate-Stage14R3-Preflight-$($plan.runId.Substring(0,8))-$($locked.preflightNonce.Substring(0,8))" -or
      $locked.trialTaskName -ne "$($plan.temporaryTaskNames.trial)-$($locked.trialNonce.Substring(0,8))" -or
      $locked.recoverTaskName -ne "$($plan.temporaryTaskNames.recover)-$($locked.recoverNonce.Substring(0,8))") {
    throw 'RUN_LOCK_TASK_NAME_MISMATCH'
  }
  $script:trialNonce = [string]$locked.trialNonce
  $script:initialRecoverNonce = [string]$locked.recoverNonce
  $runNonce = [guid]::NewGuid().ToString('N')
  $recoverNonce = [guid]::NewGuid().ToString('N')
  $recoverTask = "$($plan.temporaryTaskNames.recover)-$($recoverNonce.Substring(0,8))"
  $registered = $false
  $restored = $false
  $code = 'UNCONFIRMED'
  try {
    Register-Worker 'Recover' $recoverTask $recoverNonce
    $registered = $true
    [void](Recover-AfterStop $recoverTask $recoverNonce)
    $restored = $true
    foreach ($item in @(
      @('Preflight', [string]$locked.preflightTaskName, [string]$locked.preflightNonce),
      @('Trial', [string]$locked.trialTaskName, [string]$locked.trialNonce),
      @('Recover', [string]$locked.recoverTaskName, [string]$locked.recoverNonce)
    )) {
      if (Assert-WorkerTask $item[0] $item[1] $item[2]) {
        Unregister-ScheduledTask -TaskName $item[1] -TaskPath '\AI\' -Confirm:$false
      }
    }
    $code = 'OK'
  } catch {
    $code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
      $_.Exception.Message
    } else { 'RECOVERY_FAILED' }
  } finally {
    if ($restored -and $registered) {
      try {
        if (Assert-WorkerTask 'Recover' $recoverTask $recoverNonce) {
          Unregister-ScheduledTask -TaskName $recoverTask -TaskPath '\AI\' -Confirm:$false
        }
      } catch { $code = 'OWNED_TASK_CLEANUP_UNCONFIRMED' }
    }
    $reportPath = Join-Path $plan.acceptanceRoot "recovery-controller-$($plan.runId)-$runNonce.json"
    [ordered]@{ schemaVersion = 1; runId = $plan.runId; nonce = $runNonce;
      code = $code; restored = $restored; recoverTaskRetained = $registered -and -not $restored;
      at = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 4 |
      Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Output ("recoveryControllerFile={0} code={1} restored={2}" -f $reportPath, $code, $restored)
  }
  if (-not $restored -or $code -ne 'OK') { exit 2 }
  exit 0
}
if (-not (Process-Identity ([int]$plan.original.pid) $plan.original.createdAt `
    @($plan.original.argv) $plan.original.owner) -or
    -not (Process-Identity ([int]$plan.switcher.proxyPid) $plan.switcher.proxyCreatedAt `
      @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner) -or
    -not (Process-Identity ([int]$plan.switcher.supervisorPid) $plan.switcher.supervisorCreatedAt `
      @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner) -or
    @(LoopbackListener 8080).Count -ne 1 -or
    [int](LoopbackListener 8080)[0].OwningProcess -ne [int]$plan.original.pid -or
    @(LoopbackListener 8081).Count -ne 1 -or
    [int](LoopbackListener 8081)[0].OwningProcess -ne [int]$plan.switcher.proxyPid -or
    -not (Status-Idle ([int]$plan.original.pid)) -or
    -not (Wait-QuietConnections 10) -or -not (RecentNinferIdle)) {
  throw 'PRESTOP_IDENTITY_OR_IDLE_UNCONFIRMED'
}
if (-not $Run) {
  Write-Output ("plan=ready manifest={0} originalPid={1} proxyPid={2} supervisorPid={3} directClients=0" -f `
    $Manifest, $plan.original.pid, $plan.switcher.proxyPid, $plan.switcher.supervisorPid)
  exit 0
}

$start = Get-Date
$script:maintenanceDeadline = $start.AddSeconds(720)
$runNonce = [guid]::NewGuid().ToString('N')
$preflightNonce = [guid]::NewGuid().ToString('N')
$trialNonce = [guid]::NewGuid().ToString('N')
$script:trialNonce = $trialNonce
$recoverNonce = [guid]::NewGuid().ToString('N')
$script:initialRecoverNonce = $recoverNonce
$preflightTask = "WeftMate-Stage14R3-Preflight-$($plan.runId.Substring(0,8))-$($preflightNonce.Substring(0,8))"
$trialTask = "$($plan.temporaryTaskNames.trial)-$($trialNonce.Substring(0,8))"
$recoverTask = "$($plan.temporaryTaskNames.recover)-$($recoverNonce.Substring(0,8))"
$runLock = Join-Path $plan.acceptanceRoot "run-lock-$($plan.runId).json"
$lockStream = [IO.File]::Open($runLock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $lockBytes = [Text.Encoding]::UTF8.GetBytes((@{ schemaVersion = 1; runId = $plan.runId;
    nonce = $runNonce; preflightNonce = $preflightNonce; preflightTaskName = $preflightTask;
    trialNonce = $trialNonce; trialTaskName = $trialTask;
    recoverNonce = $recoverNonce; recoverTaskName = $recoverTask;
    workerSha256 = $plan.workerSha256;
    startedAt = $start.ToString('o'); manifestSha256 = $ManifestSha256 } |
    ConvertTo-Json -Compress))
  $lockStream.Write($lockBytes, 0, $lockBytes.Length)
} finally { $lockStream.Dispose() }
$preflightRegistered = $false
$trialRegistered = $false
$recoverRegistered = $false
$stoppedAny = $false
$restored = $false
$outcome = 'failed'
$initialFailure = $null
$recoveryFailure = $null
try {
  Register-Worker 'Preflight' $preflightTask $preflightNonce; $preflightRegistered = $true
  $preflightTriggeredAt = Get-Date
  Start-ScheduledTask -TaskName $preflightTask -TaskPath '\AI\' -ErrorAction Stop
  $preflight = Wait-Worker (Join-Path $plan.acceptanceRoot "preflight-$($plan.runId)-$preflightNonce.json") `
    'Preflight' $preflightNonce $preflightTask $preflightTriggeredAt 40
  if ($preflight.ownChildStartStop -ne $true) { throw 'S4U_PREFLIGHT_UNCONFIRMED' }
  Require-Budget 650
  Register-Worker 'Trial' $trialTask $trialNonce; $trialRegistered = $true
  Register-Worker 'Recover' $recoverTask $recoverNonce; $recoverRegistered = $true
  $originalLog = 'D:\AI\Runtime\Logs\qwen3.8-27b-ninfer.server.err.log'
  Copy-Item -LiteralPath $originalLog -Destination (Join-Path $plan.acceptanceRoot `
    "original-before-$($plan.runId).stderr.log") -ErrorAction Stop
  if (-not (Status-Idle ([int]$plan.original.pid)) -or -not (Wait-QuietConnections 10)) {
    throw 'ADMISSION_CHANGED_BEFORE_STOP'
  }
  Stop-Exact ([int]$plan.switcher.supervisorPid) $plan.switcher.supervisorCreatedAt `
    @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner ([ref]$stoppedAny)
  Stop-Exact ([int]$plan.switcher.proxyPid) $plan.switcher.proxyCreatedAt `
    @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner
  if (@(LoopbackListener 8081).Count -ne 0 -or (ActiveConnections 8080) -ne 0 -or
      -not (RecentNinferIdle)) { throw 'INGRESS_OR_MODEL_NOT_DRAINED' }
  [void](Run-Micro 'mtp3')
  if (-not (Wait-NinferQuiescent 12)) { throw 'MODEL_BUSY_AFTER_BASELINE' }
  Require-Budget 500
  Stop-Exact ([int]$plan.original.pid) $plan.original.createdAt `
    @($plan.original.argv) $plan.original.owner
  $freeDeadline = (Get-Date).AddSeconds(30)
  while (@(LoopbackListener 8080).Count -ne 0 -and (Get-Date) -lt $freeDeadline) {
    Start-Sleep -Milliseconds 250
  }
  if (@(LoopbackListener 8080).Count -ne 0) { throw 'OLD_MODEL_PORT_STILL_USED' }
  $trialTriggeredAt = Get-Date
  Start-ScheduledTask -TaskName $trialTask -TaskPath '\AI\' -ErrorAction Stop
  $trial = Wait-Worker (Join-Path $plan.acceptanceRoot "trial-$($plan.runId)-$trialNonce.json") `
    'Trial' $trialNonce $trialTask $trialTriggeredAt 175
  if ([int]$trial.pid -eq [int]$plan.original.pid) { throw 'TRIAL_PID_REUSED_WITHOUT_PROOF' }
  Require-Budget 330
  [void](Run-Micro 'no-spec')
  $outcome = 'micro-complete'
} catch {
  $initialFailure = [ordered]@{
    code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
      $_.Exception.Message
    } else { 'MAINTENANCE_FAILED' }
    type = $_.Exception.GetType().Name
    line = [int]$_.InvocationInfo.ScriptLineNumber
  }
} finally {
  if ($stoppedAny) {
    try {
      if (-not $recoverRegistered) { throw 'RECOVERY_TASK_NOT_REGISTERED' }
      [void](Recover-AfterStop $recoverTask $recoverNonce)
      $restored = $true
    } catch {
      $outcome = 'recovery-unconfirmed'
      $recoveryFailure = [ordered]@{
        code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
          $_.Exception.Message
        } else { 'RECOVERY_FAILED' }
        type = $_.Exception.GetType().Name
        line = [int]$_.InvocationInfo.ScriptLineNumber
      }
    }
  } else { $restored = $true }
  $cleanupConfirmed = $true
  if ($restored) {
    try {
      if ($preflightRegistered -and (Assert-WorkerTask 'Preflight' $preflightTask $preflightNonce)) {
        Unregister-ScheduledTask -TaskName $preflightTask -TaskPath '\AI\' -Confirm:$false
      }
      if ($trialRegistered -and (Assert-WorkerTask 'Trial' $trialTask $trialNonce)) {
        Unregister-ScheduledTask -TaskName $trialTask -TaskPath '\AI\' -Confirm:$false
      }
      if ($recoverRegistered -and (Assert-WorkerTask 'Recover' $recoverTask $recoverNonce)) {
        Unregister-ScheduledTask -TaskName $recoverTask -TaskPath '\AI\' -Confirm:$false
      }
    } catch { $cleanupConfirmed = $false; $outcome = 'task-cleanup-unconfirmed' }
  }
  $summary = [ordered]@{ schemaVersion = 1; runId = $plan.runId; nonce = $runNonce; outcome = $outcome;
    restored = $restored; cleanupConfirmed = $cleanupConfirmed;
    initialFailure = $initialFailure; recoveryFailure = $recoveryFailure;
    seconds = [math]::Round(((Get-Date) - $start).TotalSeconds, 1);
    admissionWindowUnproven = $true;
    trialTaskRetained = $trialRegistered -and -not $restored;
    recoverTaskRetained = $recoverRegistered -and -not $restored;
    preflightTaskRetained = $preflightRegistered -and -not $restored }
  $summaryPath = Join-Path $plan.acceptanceRoot "orchestration-$($plan.runId)-$runNonce.json"
  $summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  Write-Output ("orchestrationFile={0} outcome={1} restored={2}" -f $summaryPath, $outcome, $restored)
  if (-not $restored) { throw 'RECOVERY_UNCONFIRMED' }
  if (-not $cleanupConfirmed) { throw 'OWNED_TASK_CLEANUP_UNCONFIRMED' }
}
if ($null -ne $initialFailure) { throw $initialFailure.code }
