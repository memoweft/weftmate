# One-shot S4U worker for an explicitly reviewed Stage14R3 manifest.
# Only the orchestrator registers its exact Trial and Recover task actions.
param(
  [ValidateSet('Preflight', 'Trial', 'Recover')][string]$Action,
  [string]$Manifest,
  [string]$ManifestSha256,
  [string]$StatusFile,
  [string]$Nonce,
  [switch]$SelfTest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function File-Hash([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Listener8080 {
  return @(Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -Unique OwningProcess)
}
function HasDirectClients {
  return @(Get-NetTCPConnection -State Established -LocalPort 8080 -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count -gt 0
}
function Exact-Owner([object]$entry, [object]$expected) {
  try {
    $owner = Invoke-CimMethod -InputObject $entry -MethodName GetOwner -ErrorAction Stop
    return $owner.ReturnValue -eq 0 -and
      [string]::Equals([string]$owner.User, [string]$expected.user,
        [StringComparison]::OrdinalIgnoreCase) -and
      [string]::Equals([string]$owner.Domain, [string]$expected.domain,
        [StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}
$argvSource = @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class WeftMateWorkerArgv {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  private static extern IntPtr CommandLineToArgvW(string line, out int count);
  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr value);
  public static string[] Parse(string line) {
    int count;
    IntPtr values = CommandLineToArgvW(line, out count);
    if (values == IntPtr.Zero || count < 1 || count > 64) throw new InvalidOperationException();
    try {
      string[] result = new string[count];
      for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(values, i * IntPtr.Size));
      return result;
    } finally { LocalFree(values); }
  }
}
public static class WeftMateCurrentToken {
  [DllImport("advapi32.dll", SetLastError=true)]
  private static extern bool GetTokenInformation(IntPtr token, int infoClass,
    IntPtr output, int length, out int needed);
  public static string Elevation(IntPtr token) {
    IntPtr buffer = Marshal.AllocHGlobal(4);
    try { int needed;
      if (!GetTokenInformation(token, 18, buffer, 4, out needed)) return "unknown";
      switch (Marshal.ReadInt32(buffer)) {
        case 1: return "Default"; case 2: return "Full";
        case 3: return "Limited"; default: return "unknown";
      }
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public static string Integrity(IntPtr token) {
    int needed; GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
    if (needed < IntPtr.Size || needed > 4096) return "unknown";
    IntPtr buffer = Marshal.AllocHGlobal(needed);
    try {
      if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return "unknown";
      return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
    } catch { return "unknown"; }
    finally { Marshal.FreeHGlobal(buffer); }
  }
}
public static class WeftMateAccessProbe {
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr value);
  public static bool Can(uint pid, uint access) {
    IntPtr handle = OpenProcess(access, false, pid);
    if (handle == IntPtr.Zero) return false;
    CloseHandle(handle);
    return true;
  }
}
'@
Add-Type -TypeDefinition $argvSource
function Exact-Process([int]$processId, [string[]]$expectedArgv, [object]$owner,
  [datetime]$notBefore) {
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $entry -or -not $entry.CommandLine -or -not $entry.ExecutablePath -or
      [int]$entry.SessionId -ne 0 -or -not (Exact-Owner $entry $owner) -or
      ([datetime]$entry.CreationDate) -lt $notBefore -or
      -not [string]::Equals([string]$entry.ExecutablePath, $expectedArgv[0],
        [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $actual = [WeftMateWorkerArgv]::Parse([string]$entry.CommandLine)
  if ($actual.Count -ne $expectedArgv.Count) { return $false }
  for ($index = 0; $index -lt $actual.Count; $index++) {
    $comparison = if ($index -lt 2) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals($actual[$index], $expectedArgv[$index], $comparison)) { return $false }
  }
  return $true
}
function Atomic-Json([string]$path, [object]$value) {
  $temporary = "$path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    if (Test-Path -LiteralPath $path) {
      $backup = Join-Path $plan.acceptanceRoot ((Split-Path -Leaf $path) + ".before-stage14r3-$($plan.runId).json")
      [IO.File]::Replace($temporary, $path, $backup)
    } else { Move-Item -LiteralPath $temporary -Destination $path }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}
function Ready-Model {
  try {
    $catalog = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/v1/models' -TimeoutSec 5 -DisableKeepAlive
    return @($catalog.data.id) -contains 'qwen3.8-27b'
  } catch { return $false }
}
function Ready-Switcher([int]$expectedPid) {
  $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY', 'User')
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('MODEL_SWITCH_UNIFIED_KEY', 'Machine')
  }
  if ([string]::IsNullOrWhiteSpace($key)) { return $false }
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/switch/status' -TimeoutSec 5 -DisableKeepAlive `
      -Headers @{ Authorization = "Bearer $key" }
    return $result.currentModelId -eq 'qwen3.8-27b' -and $result.probe.health -eq $true -and
      [int]$result.state.pid -eq $expectedPid -and $result.switching -eq $false
  } catch { return $false }
}
function Start-Exact([string[]]$argv, [string]$label) {
  if (@(Listener8080).Count -ne 0 -or (HasDirectClients)) { throw 'NINFER_PORT_NOT_FREE' }
  $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
  $stdout = Join-Path $plan.acceptanceRoot "$label-$stamp.stdout.log"
  $stderr = Join-Path $plan.acceptanceRoot "$label-$stamp.stderr.log"
  $started = Get-Date
  $process = Start-Process -FilePath $argv[0] -ArgumentList $argv[1..($argv.Count - 1)] `
    -WorkingDirectory $plan.original.declaredWorkingDirectory -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction Stop
  if ($null -eq $entry -or -not $entry.CreationDate) { throw 'STARTED_PROCESS_IDENTITY_UNAVAILABLE' }
  $report = [ordered]@{ schemaVersion = 1; runId = $plan.runId; action = $Action;
    nonce = $Nonce; token = $tokenFacts; kind = $label;
    pid = $process.Id; startedAt = $started.ToString('o');
    processCreatedAt = ([datetime]$entry.CreationDate).ToString('o');
    stdout = $stdout; stderr = $stderr; ready = $false }
  $reportPath = Join-Path $plan.acceptanceRoot "$label-$($plan.runId)-$Nonce.json"
  Atomic-Json $reportPath $report
  $deadline = (Get-Date).AddSeconds(150)
  do {
    if ($process.HasExited) { throw 'NINFER_PROCESS_EXITED' }
    $listeners = @(Listener8080)
    if ($listeners.Count -eq 1 -and [int]$listeners[0].OwningProcess -eq $process.Id -and
        (Exact-Process $process.Id $argv $plan.original.owner $started) -and (Ready-Model)) {
      $report.ready = $true
      Atomic-Json $reportPath $report
      Write-Output ("workerResult={0} ready=true" -f $reportPath)
      return $report
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw 'NINFER_START_TIMEOUT'
}

if ($SelfTest) {
  function Listener8080 { return @() }
  function HasDirectClients { return $false }
  function Start-Process { throw 'SYNTHETIC_START_REACHED' }
  $plan = [pscustomobject]@{ runId = 'synthetic'; acceptanceRoot = [IO.Path]::GetTempPath();
    original = [pscustomobject]@{ declaredWorkingDirectory = [IO.Path]::GetTempPath() } }
  try { [void](Start-Exact @('synthetic.exe','model.ninfer') 'trial'); throw 'EMPTY_PORT_BLOCKED' }
  catch { if ($_.Exception.Message -ne 'SYNTHETIC_START_REACHED') { throw } }
  if (@(Listener8080).Count -ne 0) { throw 'EMPTY_LISTENER_COUNT_WRONG' }
  Write-Output 'stage14r3-worker-selftest=passed'
  exit 0
}

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$statusRoot = Join-Path (Split-Path -Parent $repository) 'Runtime\UnifiedAssistant\Stage14R3Acceptance-20261004'
$statusAllowed = $StatusFile -and
  [IO.Path]::GetFullPath($StatusFile) -eq [IO.Path]::GetFullPath((Join-Path $statusRoot (Split-Path -Leaf $StatusFile))) -and
  (Split-Path -Leaf $StatusFile) -match '^worker-status-(?:Preflight|Trial|Recover)-[0-9a-f-]{36}-[0-9a-f]{32}\.json$'
$plan = $null
$tokenFacts = $null
try {

if (-not $Manifest -or -not $ManifestSha256 -or $ManifestSha256 -notmatch '^[a-f0-9]{64}$' -or
    $Nonce -notmatch '^[0-9a-f]{32}$' -or
    -not (Test-Path -LiteralPath $Manifest -PathType Leaf) -or
    (File-Hash $Manifest) -ne $ManifestSha256) { throw 'MANIFEST_INVALID' }
$plan = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.schemaVersion -ne 1 -or $plan.purpose -ne 'stage14r3-ephemeral-ninfer-maintenance' -or
    $plan.readyForExecution -ne $false -or $plan.workerSha256 -ne (File-Hash $MyInvocation.MyCommand.Path) -or
    $plan.expectedConfigSha256 -ne (File-Hash 'D:\AI\Config\qwen3.8-27b-ninfer.json') -or
    [IO.Path]::GetFullPath($Manifest) -ne [IO.Path]::GetFullPath((Join-Path $plan.acceptanceRoot (Split-Path -Leaf $Manifest)))) {
  throw 'PLAN_IDENTITY_INVALID'
}
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$tokenFacts = [ordered]@{
  name = $currentIdentity.Name
  sid = if ($currentIdentity.User) { $currentIdentity.User.Value } else { $null }
  sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  adminRole = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  elevationType = [WeftMateCurrentToken]::Elevation($currentIdentity.Token)
  integritySid = [WeftMateCurrentToken]::Integrity($currentIdentity.Token)
}
$expectedToken = $plan.requiredToken
if ($null -eq $expectedToken -or
    -not [string]::Equals([string]$tokenFacts.sid, [string]$expectedToken.sid, [StringComparison]::Ordinal) -or
    -not [string]::Equals([string]$tokenFacts.name, [string]$expectedToken.name, [StringComparison]::OrdinalIgnoreCase) -or
    [int]$tokenFacts.sessionId -ne [int]$expectedToken.sessionId -or
    [string]$tokenFacts.elevationType -cne [string]$expectedToken.elevationType -or
    [string]$tokenFacts.integritySid -cne [string]$expectedToken.integritySid) {
  throw 'WORKER_TOKEN_MISMATCH'
}

if ($Action -eq 'Preflight') {
  $originalRead = Exact-Process ([int]$plan.original.pid) @($plan.original.argv) $plan.original.owner ([datetime]$plan.original.createdAt)
  $proxyRead = Exact-Process ([int]$plan.switcher.proxyPid) @($plan.switcher.proxyArgv) $plan.switcher.proxyOwner ([datetime]$plan.switcher.proxyCreatedAt)
  $supervisorRead = Exact-Process ([int]$plan.switcher.supervisorPid) @($plan.switcher.supervisorArgv) $plan.switcher.supervisorOwner ([datetime]$plan.switcher.supervisorCreatedAt)
  $queryOld = [WeftMateAccessProbe]::Can([uint32]$plan.original.pid, 0x1000)
  $terminateOld = [WeftMateAccessProbe]::Can([uint32]$plan.original.pid, 0x0001)
  $statusRead = Ready-Switcher ([int]$plan.original.pid)
  $fake = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
    -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') `
    -WindowStyle Hidden -PassThru
  try {
    $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $($fake.Id)" -ErrorAction Stop
    if ($null -eq $entry -or [int]$entry.SessionId -ne 0 -or
        -not (Exact-Owner $entry $plan.original.owner)) { throw 'S4U_FAKE_PROCESS_IDENTITY_UNCONFIRMED' }
    Stop-Process -Id $fake.Id -Force -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Process -Id $fake.Id -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $fake.Id -ErrorAction SilentlyContinue) { throw 'S4U_FAKE_PROCESS_STOP_UNCONFIRMED' }
  } finally {
    if (Get-Process -Id $fake.Id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
    }
  }
  $reportPath = Join-Path $plan.acceptanceRoot "preflight-$($plan.runId)-$Nonce.json"
  Atomic-Json $reportPath ([ordered]@{ schemaVersion = 1; runId = $plan.runId;
    kind = 's4u-preflight'; action = $Action; nonce = $Nonce; token = $tokenFacts;
    existingProcessRead = $originalRead; proxyRead = $proxyRead;
    supervisorRead = $supervisorRead; queryOld = $queryOld;
    terminateOld = $terminateOld; ownChildStartStop = $true; statusRead = $statusRead;
    at = (Get-Date).ToString('o'); ready = $true })
  if ($statusAllowed) {
    [ordered]@{ schemaVersion = 1; runId = $plan.runId; action = $Action;
      nonce = $Nonce; phase = 'completed'; code = 'OK'; at = (Get-Date).ToString('o') } |
      ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
  }
  Write-Output ("workerResult={0} ready=true" -f $reportPath)
  exit 0
}

if ($Action -eq 'Trial') {
  if (@(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count -ne 0) { throw 'SWITCHER_INGRESS_NOT_FENCED' }
  if (Test-Path -LiteralPath (Join-Path $plan.acceptanceRoot "trial-$($plan.runId).json")) {
    throw 'TRIAL_ALREADY_STARTED'
  }
  [void](Start-Exact @($plan.trial.argv) 'trial')
  exit 0
}

# The administrator has already fenced ingress and stopped the exact temporary
# PID. A separate S4U task only starts the original route under its original
# owner/session. It never terminates an existing process.
if (@(Listener8080).Count -ne 0 -or (HasDirectClients)) { throw 'RECOVERY_PORT_NOT_FREE' }
[void](Start-Exact @($plan.original.argv) 'restore')
} catch {
  $code = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{3,80}$') {
    $_.Exception.Message
  } else { 'WORKER_FAILED' }
  if ($statusAllowed) {
    try {
      [ordered]@{ schemaVersion = 1; runId = if ($null -ne $plan) { $plan.runId } else { $null };
        action = $Action; nonce = $Nonce; phase = 'failed'; code = $code;
        token = $tokenFacts;
        errorType = $_.Exception.GetType().Name;
        errorLine = [int]$_.InvocationInfo.ScriptLineNumber;
        at = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 3 |
        Set-Content -LiteralPath $StatusFile -Encoding UTF8
    } catch { }
  }
  exit 2
}
