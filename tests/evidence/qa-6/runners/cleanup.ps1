$ErrorActionPreference = 'Stop'
$qa6Repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$qa6Evidence = Join-Path $qa6Repo 'tests/evidence/qa-6'
$qa6Baseline = Get-Content (Join-Path $qa6Evidence 'baseline.json') -Raw | ConvertFrom-Json
$qa6Smoke = Get-Content (Join-Path $qa6Evidence 'smoke/results.json') -Raw | ConvertFrom-Json
if (-not $qa6Smoke.finishedAt -or $qa6Smoke.elapsedMs -lt 1200000) { throw 'Smoke must complete before cleanup' }
$qa6Roots = @($qa6Repo)
foreach ($qa6File in Get-ChildItem $qa6Evidence -Recurse -File | Where-Object { $_.Name -in @('run-root.txt','install-root.txt','launch-fixture-root.txt') }) {
  $qa6Value = (Get-Content -LiteralPath $qa6File.FullName -Raw).Trim()
  if ([IO.Path]::IsPathRooted($qa6Value) -and [IO.Path]::GetFileName($qa6Value) -like 'weftmate-qa6-*') { $qa6Roots += [IO.Path]::GetFullPath($qa6Value) }
}
$qa6Roots = @($qa6Roots | Select-Object -Unique)
foreach ($qa6Log in @('required-unit-tests.txt')) {
  foreach ($qa6Line in Get-Content (Join-Path $qa6Evidence $qa6Log) -TotalCount 4) {
    if ($qa6Line -match 'isolated canonical temp: (.+)[.]$') { $qa6Roots += $Matches[1] }
  }
}
function Get-Qa5Processes {
  @(Get-CimInstance Win32_Process | Where-Object {
    if (-not $_.ExecutablePath -or $_.CreationDate -lt [datetime]$qa6Baseline.startedAt -or $_.Name -notmatch '^(node|electron|python|wsl|WeftMate|frpc|haproxy)[.]exe$') { return $false }
    $qa6Command = $_.CommandLine.Replace([char]47,[char]92)
    if ($qa6Command -match 'personal-account-20260926|--access-port[= ]18186|llama-server') { return $false }
    @($qa6Roots | Where-Object { $qa6Command.Contains($_.Replace([char]47,[char]92)) }).Count -gt 0
  })
}
$qa6Owned = @(Get-Qa5Processes)
$qa6Stopped = @($qa6Owned | Select-Object ProcessId,Name,CreationDate)
foreach ($qa6Process in $qa6Owned) { Stop-Process -Id $qa6Process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$qa6Remaining = @(Get-Qa5Processes | Select-Object ProcessId,Name,CreationDate)
$qa6Recorded = @()
foreach ($qa6File in Get-ChildItem $qa6Evidence -File -Filter '*cleanup.json' | Where-Object { $_.Name -ne 'cleanup.json' }) {
  try { $qa6Value = Get-Content $qa6File.FullName -Raw | ConvertFrom-Json; $qa6Recorded += @($qa6Value | Where-Object { $_.ProcessId -and $_.CreationDate }) } catch { }
}
$qa6Recorded += $qa6Stopped
$qa6Unique = @($qa6Recorded | Group-Object { [string]$_.ProcessId + '|' + [string]$_.CreationDate } | ForEach-Object { $_.Group[0] })
$qa6Core = @()
$qa6Live = @(Get-CimInstance Win32_Process)
foreach ($qa6Root in $qa6Roots) {
  if ($qa6Root -eq $qa6Repo) { continue }
  $qa6Trace = Join-Path $qa6Root 'trace.jsonl'
  if (-not (Test-Path -LiteralPath $qa6Trace)) { continue }
  foreach ($qa6Line in Get-Content -LiteralPath $qa6Trace) {
    try { $qa6Entry = $qa6Line | ConvertFrom-Json } catch { continue }
    if ($qa6Entry.kind -ne 'core-process') { continue }
    $qa6Match = @($qa6Live | Where-Object { $_.ProcessId -eq $qa6Entry.pid -and $_.Name -eq 'python.exe' -and [math]::Abs(($_.CreationDate.ToUniversalTime() - ([datetime]$qa6Entry.at).ToUniversalTime()).TotalSeconds) -lt 5 })
    $qa6Core += @($qa6Match | Select-Object ProcessId,Name,CreationDate)
  }
}
$qa6OwnLock = $false
$qa6Deleted = @()
$qa6DeletionFailures = @()
foreach ($qa6Root in $qa6Roots) {
  if ($qa6Root -eq $qa6Repo -or -not (Test-Path -LiteralPath $qa6Root)) { continue }
  $qa6Absolute = (Resolve-Path -LiteralPath $qa6Root).Path
  $qa6Leaf = [IO.Path]::GetFileName($qa6Absolute)
  $qa6Allowed = ($qa6Absolute.StartsWith([IO.Path]::GetFullPath($env:TEMP), [StringComparison]::OrdinalIgnoreCase) -and $qa6Leaf -like 'weftmate-qa6-*') -or ($qa6Absolute -match '^C:\\weftmate-ci-[A-Za-z0-9]+$')
  if (-not $qa6Allowed) { throw ('Refusing unexpected cleanup target: ' + $qa6Absolute) }
  if ((Get-Item -LiteralPath $qa6Absolute).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Root must not be a junction' }
  try { Remove-Item -LiteralPath $qa6Absolute -Recurse -Force; $qa6Deleted += $qa6Absolute } catch { $qa6DeletionFailures += @{path=$qa6Absolute;error=$_.Exception.Message} }
}
$qa6Report = [ordered]@{
  at = (Get-Date -Format o)
  criteria = 'creation after baseline start + executable path + command line containing this worktree or recorded QA6 temporary path; no parent-PID matching'
  extraStoppedNow = $qa6Stopped
  uniqueRecordedTerminations = $qa6Unique.Count
  recordedTerminations = $qa6Unique
  remainingOwnedProcesses = $qa6Remaining
  remainingRecordedCoreProcesses = $qa6Core
  backupCopiesRemaining = @(Get-ChildItem $env:TEMP -Directory -Filter 'weftmate-qa6-migration-*').Count
  privateSigningDirectoriesRemaining = @(Get-ChildItem $env:TEMP -Directory -Filter 'weftmate-qa6-signing-*').Count
  ownLanLockRemaining = $qa6OwnLock
  emulatorStarted = $false
  emulatorStopped = $false
  deletedOwnedDirectories = $qa6Deleted
  directoryDeletionFailures = $qa6DeletionFailures
}
$qa6Report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $qa6Evidence 'cleanup.json') -Encoding utf8
if ($qa6DeletionFailures.Count -or $qa6Remaining.Count -or $qa6Core.Count -or $qa6OwnLock -or $qa6Report.backupCopiesRemaining -or $qa6Report.privateSigningDirectoriesRemaining) { throw 'Cleanup verification incomplete; see cleanup.json' }
