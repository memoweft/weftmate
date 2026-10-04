# One-time recovery of the original ModelSwitcher supervisor after the R3
# optional-[ref] Stop-Exact binding failure. It never stops or starts NInfer.
param([switch]$Run)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = 'D:\AIProjects\WeftMate\Runtime\UnifiedAssistant\Stage14R3Acceptance-20261004'
$manifestFile = Join-Path $root 'manifest-2d7d9250-9771-4a40-b33c-ff2091a9a2c2.json'
$manifestHash = '6e03ed2cd1d46c2eccdb877281e60e363d5eca2c6fef0332e1c8da9bf5bd6344'
$report = Join-Path $root ('switcher-emergency-' + [guid]::NewGuid().ToString('N') + '.json')
$phase = 'preflight'
$code = 'UNCONFIRMED'
$proxyStopAttempted = $false
$proxyStopped = $false
$taskTriggered = $false
$fallbackTriggered = $false
$newProxyPid = $null
$newSupervisorPid = $null

$source = @'
using System;
using System.Runtime.InteropServices;
public static class WeftMateR3Emergency {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  private static extern IntPtr CommandLineToArgvW(string value, out int count);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr value);
  public static bool CanTerminate(uint pid) {
    IntPtr handle = OpenProcess(0x0001, false, pid);
    if (handle == IntPtr.Zero) return false;
    CloseHandle(handle); return true;
  }
  public static string[] Args(string line) {
    int count; IntPtr values = CommandLineToArgvW(line, out count);
    if (values == IntPtr.Zero || count < 1 || count > 64) throw new InvalidOperationException();
    try { string[] result = new string[count];
      for (int i=0;i<count;i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values,i*IntPtr.Size));
      return result; } finally { CloseLocal(values); }
  }
  [DllImport("kernel32.dll", EntryPoint="LocalFree")]
  private static extern IntPtr CloseLocal(IntPtr value);
}
'@
Add-Type -TypeDefinition $source
function Exact-Process([int]$processId, [string]$createdAt, [string[]]$argv,
  [object]$owner, [switch]$New) {
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $entry -or -not $entry.CommandLine -or -not $entry.ExecutablePath -or
      [int]$entry.SessionId -ne 0 -or
      -not [string]::Equals([string]$entry.ExecutablePath, $argv[0],
        [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $created = ([datetime]$entry.CreationDate).ToUniversalTime().Ticks
  $bound = ([datetime]$createdAt).ToUniversalTime().Ticks
  if ($New) { if ($created -le $bound) { return $false } }
  elseif ($created -ne $bound) { return $false }
  $who = Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction SilentlyContinue
  if ($who.ReturnValue -ne 0 -or
      -not [string]::Equals([string]$who.User, [string]$owner.user,
        [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([string]$who.Domain, [string]$owner.domain,
        [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $actual = [WeftMateR3Emergency]::Args([string]$entry.CommandLine)
  if ($actual.Count -ne $argv.Count) { return $false }
  for ($index=0;$index -lt $argv.Count;$index++) {
    $comparison = if ($index -lt 2) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals($actual[$index],$argv[$index],$comparison)) { return $false }
  }
  return $true
}
function Listener([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
}
function Established([int]$port) {
  return @(Get-NetTCPConnection -State Established -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count
}
function Wait-Quiet([int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  do {
    if ((Established 8080) -eq 0 -and (Established 8081) -eq 0) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $until)
  return $false
}
function No-UnknownSupervisor($plan) {
  $scriptPath = [string]$plan.switcher.supervisorArgv[-1]
  $found = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and ([string]$_.CommandLine).IndexOf(
      $scriptPath,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
  return $found.Count -eq 0
}
function Exact-RegisteredTask($plan) {
  $task = Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
  $actions = @($task.Actions)
  return $task.Principal.UserId -eq $plan.switcher.principalUserId -and
    [string]$task.Principal.LogonType -eq 'S4U' -and
    [string]$task.Principal.RunLevel -eq 'Limited' -and $actions.Count -eq 1 -and
    [string]::Equals([string]$actions[0].Execute,
      [string]$plan.switcher.registeredTaskAction.execute,[StringComparison]::OrdinalIgnoreCase) -and
    [string]::Equals([string]$actions[0].Arguments,
      [string]$plan.switcher.registeredTaskAction.arguments,[StringComparison]::Ordinal) -and
    [string]::Equals([string]$actions[0].WorkingDirectory,
      [string]$plan.switcher.registeredTaskAction.workingDirectory,[StringComparison]::OrdinalIgnoreCase)
}
function Preserved-Logs($plan) {
  $files = @('D:\AI\Control\Logs\ModelSwitcher\supervisor.stdout.log',
    'D:\AI\Control\Logs\ModelSwitcher\supervisor.stderr.log')
  $state = Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $files += @([string]$state.stdout,[string]$state.stderr)
  foreach ($file in $files | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $destination = Join-Path $root ((Split-Path -Leaf $file) + '.before-emergency-' + $plan.runId)
    Copy-Item -LiteralPath $file -Destination $destination -ErrorAction Stop
  }
}
function Ready-Status([int]$modelPid) {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { return $false }
  try {
    $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 `
      -DisableKeepAlive -Headers @{ Authorization = "Bearer $key" }
    return $s.currentModelId -eq 'qwen3.8-27b' -and $s.probe.health -eq $true -and
      [int]$s.state.pid -eq $modelPid -and $s.switching -eq $false
  } catch { return $false }
}
function Idle-Status([int]$modelPid) {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY','Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { return $false }
  try {
    $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 `
      -DisableKeepAlive -Headers @{ Authorization = "Bearer $key" }
    return $s.currentModelId -eq 'qwen3.8-27b' -and $s.probe.health -eq $true -and
      [int]$s.state.pid -eq $modelPid -and $s.switching -eq $false -and
      [int]$s.activeLeases -eq 0 -and [int]$s.queuedLeases -eq 0 -and
      [int]$s.maintenanceQueued -eq 0
  } catch { return $false }
}
function Confirm-Restored($plan) {
  $until = (Get-Date).AddSeconds(45)
  do {
    $newListener = @(Listener 8081)
    if ($newListener.Count -eq 1 -and (Ready-Status 25644)) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $until)
  if ($newListener.Count -ne 1 -or -not (Ready-Status 25644)) { throw 'SWITCHER_RESTORE_UNCONFIRMED' }
  $candidateProxy = [int]$newListener[0].OwningProcess
  $state = Get-Content 'D:\AI\Control\State\ModelSwitcher\switcher.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $candidateSupervisor = [int]$state.supervisorPid
  $proxyVerified = Exact-Process $candidateProxy $plan.acceptedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner -New
  $supervisorVerified = Exact-Process $candidateSupervisor $plan.acceptedAt @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner -New
  if ($candidateProxy -eq 17092 -or $candidateSupervisor -eq 16464 -or
      -not $proxyVerified -or -not $supervisorVerified -or
      -not (Exact-Process 25644 $plan.original.createdAt @($plan.original.argv) $plan.original.owner)) {
    throw 'RESTORED_PROCESS_IDENTITY_UNCONFIRMED'
  }
  return [pscustomobject]@{ proxyPid = $candidateProxy; supervisorPid = $candidateSupervisor }
}

try {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
  if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf) -or
      (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestHash) {
    throw 'MANIFEST_CHANGED'
  }
  $plan = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($plan.runId -ne 'f35d540c-5ce1-471b-8155-ad2bc185d09b' -or
      [int]$plan.original.pid -ne 25644 -or [int]$plan.switcher.proxyPid -ne 17092 -or
      [int]$plan.switcher.supervisorPid -ne 16464) { throw 'MANIFEST_IDENTITY_CHANGED' }
  if (-not (Exact-Process 25644 $plan.original.createdAt @($plan.original.argv) $plan.original.owner)) {
    throw 'ORIGINAL_NINFER_CHANGED'
  }
  if (-not (Exact-Process 17092 $plan.switcher.proxyCreatedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner)) {
    throw 'ORIGINAL_PROXY_CHANGED'
  }
  if (Get-CimInstance Win32_Process -Filter 'ProcessId = 16464' -ErrorAction SilentlyContinue) {
    throw 'ORIGINAL_SUPERVISOR_REAPPEARED'
  }
  if (-not (No-UnknownSupervisor $plan)) { throw 'UNKNOWN_SUPERVISOR_PRESENT' }
  $modelListener = @(Listener 8080)
  $proxyListener = @(Listener 8081)
  if ($modelListener.Count -ne 1 -or [int]$modelListener[0].OwningProcess -ne 25644 -or
      $proxyListener.Count -ne 1 -or [int]$proxyListener[0].OwningProcess -ne 17092) {
    throw 'ORIGINAL_LISTENERS_CHANGED'
  }
  if (-not (Exact-RegisteredTask $plan)) { throw 'ORIGINAL_TASK_CHANGED' }
  if (-not [WeftMateR3Emergency]::CanTerminate(17092)) { throw 'PROXY_TERMINATE_HANDLE_UNAVAILABLE' }
  if (-not (Idle-Status 25644) -or -not (Wait-Quiet 10)) { throw 'PROXY_OR_MODEL_BUSY' }
  $phase = 'verified'
  if ($Run) {
    Preserved-Logs $plan
    $phase = 'stop_proxy'
    if (-not (No-UnknownSupervisor $plan) -or -not (Idle-Status 25644) -or
        -not (Wait-Quiet 10)) { throw 'ADMISSION_CHANGED_BEFORE_STOP' }
    if (-not (Exact-Process 17092 $plan.switcher.proxyCreatedAt @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner)) {
      throw 'ORIGINAL_PROXY_CHANGED'
    }
    $proxyStopAttempted = $true
    Stop-Process -Id 17092 -Force -ErrorAction Stop
    $proxyStopped = $true
    $until = (Get-Date).AddSeconds(15)
    while (@(Listener 8081).Count -ne 0 -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 200 }
    if (@(Listener 8081).Count -ne 0) { throw 'PROXY_PORT_NOT_FREE' }
    $phase = 'start_original_task'
    if (-not (Exact-RegisteredTask $plan)) { throw 'ORIGINAL_TASK_CHANGED' }
    Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
    $taskTriggered = $true
    $confirmed = Confirm-Restored $plan
    $newProxyPid = $confirmed.proxyPid
    $newSupervisorPid = $confirmed.supervisorPid
    $phase = 'restored'; $code = 'OK'
  } else { $code = 'READY_READ_ONLY' }
} catch {
  $code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
    $_.Exception.Message
  } else { 'EMERGENCY_RECOVERY_FAILED' }
  if ($Run -and $proxyStopAttempted -and $phase -ne 'restored') {
    try {
      $originalTask = Get-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
      $remainingProxy = @(Listener 8081)
      $remainingModel = @(Listener 8080)
      $supervisorScript = [string]$plan.switcher.supervisorArgv[-1]
      $otherSupervisors = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -and ([string]$_.CommandLine).IndexOf(
          $supervisorScript,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
      if ($remainingProxy.Count -ne 0 -or $otherSupervisors.Count -ne 0 -or
          $remainingModel.Count -ne 1 -or [int]$remainingModel[0].OwningProcess -ne 25644 -or
          [string]$originalTask.State -eq 'Running' -or
          -not (Exact-RegisteredTask $plan) -or
          -not (Exact-Process 25644 $plan.original.createdAt @($plan.original.argv) $plan.original.owner)) {
        throw 'FALLBACK_GATE_UNCONFIRMED'
      }
      $phase = 'fallback_original_task'
      Start-ScheduledTask -TaskName 'ModelSwitcher-A-Logon' -TaskPath '\' -ErrorAction Stop
      $fallbackTriggered = $true
      $confirmed = Confirm-Restored $plan
      $newProxyPid = $confirmed.proxyPid
      $newSupervisorPid = $confirmed.supervisorPid
      $phase = 'restored'; $code = 'OK_AFTER_FALLBACK'
    } catch { if ($code -eq 'UNCONFIRMED') { $code = 'FALLBACK_UNCONFIRMED' } }
  }
} finally {
  [ordered]@{ schemaVersion=1; kind='stage14r3-original-switcher-emergency';
    at=(Get-Date).ToString('o'); phase=$phase; code=$code; run=$Run.IsPresent;
    proxyStopAttempted=$proxyStopAttempted; proxyStopped=$proxyStopped;
    taskTriggered=$taskTriggered; fallbackTriggered=$fallbackTriggered;
    originalNinferPid=25644; newProxyPid=$newProxyPid; newSupervisorPid=$newSupervisorPid } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $report -Encoding UTF8
  Write-Output ("emergencyReport={0} phase={1} code={2}" -f $report,$phase,$code)
}
if ($code -notin @('OK','OK_AFTER_FALLBACK','READY_READ_ONLY')) { exit 2 }
