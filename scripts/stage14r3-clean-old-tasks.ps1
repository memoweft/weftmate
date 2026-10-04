# Removes only the four exact orphaned Stage14R3 tasks after original services
# have been independently restored. Default mode is read-only.
param([switch]$Run)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = 'D:\AIProjects\WeftMate\Runtime\UnifiedAssistant\Stage14R3Acceptance-20261004'
$manifestFile = Join-Path $root 'manifest-2d7d9250-9771-4a40-b33c-ff2091a9a2c2.json'
$manifestHash = '6e03ed2cd1d46c2eccdb877281e60e363d5eca2c6fef0332e1c8da9bf5bd6344'
$reportFile = Join-Path $root ('old-task-cleanup-' + [guid]::NewGuid().ToString('N') + '.json')
$entries = @(
  [pscustomobject]@{ name='WeftMate-Stage14R3-Preflight-f35d540c-d5c34bb7'; action='Preflight'; nonce='d5c34bb7ad0b44a9acd7978c4cd7276d' },
  [pscustomobject]@{ name='WeftMate-Stage14R3-Trial-f35d540c-40beb050'; action='Trial'; nonce='40beb05085284c799b758dd082deb66c' },
  [pscustomobject]@{ name='WeftMate-Stage14R3-Recover-f35d540c-111f191b'; action='Recover'; nonce='111f191b1192401396442e4274ac3cdf' },
  [pscustomobject]@{ name='WeftMate-Stage14R3-Recover-f35d540c-906e5778'; action='Recover'; nonce='906e57786c1040ef857de47aaffde17a' }
)
$code = 'UNCONFIRMED'
$verified = @()
$removed = @()
function Listener([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
}
function Healthy-Original {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { return $false }
  try {
    $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 `
      -DisableKeepAlive -Headers @{Authorization="Bearer $key"}
    return $s.currentModelId -eq 'qwen3.8-27b' -and $s.probe.health -eq $true -and
      [int]$s.state.pid -eq 25644 -and $s.switching -eq $false
  } catch { return $false }
}
try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
  if ((Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestHash) {
    throw 'MANIFEST_CHANGED'
  }
  $plan = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($plan.runId -ne 'f35d540c-5ce1-471b-8155-ad2bc185d09b') { throw 'MANIFEST_RUN_CHANGED' }
  $model = @(Listener 8080); $proxy = @(Listener 8081)
  if ($model.Count -ne 1 -or [int]$model[0].OwningProcess -ne 25644 -or
      $proxy.Count -ne 1 -or [int]$proxy[0].OwningProcess -ne 37880 -or
      -not (Get-CimInstance Win32_Process -Filter 'ProcessId = 36092' -ErrorAction SilentlyContinue) -or
      -not (Healthy-Original)) { throw 'RESTORED_SERVICE_IDENTITY_UNCONFIRMED' }
  $originalTask = Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  $originalAction = @($originalTask.Actions)
  if ($originalAction.Count -ne 1 -or
      $originalTask.Principal.UserId -ne $plan.switcher.principalUserId -or
      [string]$originalTask.Principal.LogonType -ne 'S4U' -or
      [string]$originalTask.Principal.RunLevel -ne 'Limited' -or
      -not [string]::Equals([string]$originalAction[0].Execute,
        [string]$plan.switcher.registeredTaskAction.execute,[StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$originalAction[0].Arguments,
        [string]$plan.switcher.registeredTaskAction.arguments,[StringComparison]::Ordinal)) {
    throw 'ORIGINAL_TASK_CHANGED'
  }
  foreach ($entry in $entries) {
    $task = Get-ScheduledTask -TaskName $entry.name -TaskPath '\AI\' -ErrorAction SilentlyContinue
    if ($null -eq $task) { continue }
    $actions = @($task.Actions)
    $statusFile = Join-Path $root "worker-status-$($entry.action)-$($plan.runId)-$($entry.nonce).json"
    $expectedArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden' +
      ' -File "D:\AIProjects\WeftMate\Repository\scripts\stage14r3-worker.ps1"' +
      ' -Action ' + $entry.action + ' -Manifest "' + $manifestFile + '"' +
      ' -ManifestSha256 ' + $manifestHash + ' -StatusFile "' + $statusFile + '"' +
      ' -Nonce ' + $entry.nonce
    if ([string]$task.State -ne 'Ready' -or $actions.Count -ne 1 -or
        $task.Principal.UserId -ne 'yun' -or
        [string]$task.Principal.LogonType -ne 'S4U' -or
        [string]$task.Principal.RunLevel -ne 'Limited' -or
        -not [string]::Equals([string]$actions[0].Execute,
          (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
          [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([string]$actions[0].Arguments,$expectedArgs,[StringComparison]::Ordinal) -or
        -not [string]::Equals([string]$actions[0].WorkingDirectory,
          'D:\AIProjects\WeftMate\Repository\scripts',[StringComparison]::OrdinalIgnoreCase)) {
      throw 'OWNED_TASK_DEFINITION_CHANGED'
    }
    $verified += $entry.name
  }
  $code = 'READY_READ_ONLY'
  if ($Run) {
    foreach ($name in $verified) {
      Unregister-ScheduledTask -TaskName $name -TaskPath '\AI\' -Confirm:$false -ErrorAction Stop
      $removed += $name
    }
    $code = 'OK'
  }
} catch {
  $code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
    $_.Exception.Message
  } else { 'TASK_CLEANUP_FAILED' }
} finally {
  [ordered]@{ schemaVersion=1;kind='stage14r3-exact-task-cleanup';
    at=(Get-Date).ToString('o');code=$code;run=$Run.IsPresent;
    verified=$verified;removed=$removed } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $reportFile -Encoding UTF8
  Write-Output ("cleanupReport={0} code={1} verified={2} removed={3}" -f
    $reportFile,$code,$verified.Count,$removed.Count)
}
if ($code -notin @('OK','READY_READ_ONLY')) { exit 2 }
