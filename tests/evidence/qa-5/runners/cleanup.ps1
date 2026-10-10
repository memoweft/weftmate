$ErrorActionPreference = 'Stop'
$qa5Repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$qa5Evidence = Join-Path $qa5Repo 'tests/evidence/qa-5'
$qa5Baseline = Get-Content (Join-Path $qa5Evidence 'baseline.json') -Raw | ConvertFrom-Json
$qa5Smoke = Get-Content (Join-Path $qa5Evidence 'smoke/results.json') -Raw | ConvertFrom-Json
if (-not $qa5Smoke.finishedAt -or $qa5Smoke.elapsedMs -lt 1200000) { throw 'Smoke must complete before cleanup' }
$qa5Roots = @($qa5Repo)
foreach ($qa5File in Get-ChildItem $qa5Evidence -Recurse -File | Where-Object { $_.Name -in @('run-root.txt','install-root.txt','launch-fixture-root.txt') }) {
  $qa5Value = (Get-Content -LiteralPath $qa5File.FullName -Raw).Trim()
  if ([IO.Path]::IsPathRooted($qa5Value) -and [IO.Path]::GetFileName($qa5Value) -like 'weftmate-qa5-*') { $qa5Roots += [IO.Path]::GetFullPath($qa5Value) }
}
$qa5Roots = @($qa5Roots | Select-Object -Unique)
foreach ($qa5Log in @('required-unit-tests.txt','required-unit-tests-final.txt')) {
  foreach ($qa5Line in Get-Content (Join-Path $qa5Evidence $qa5Log) -TotalCount 4) {
    if ($qa5Line -match 'isolated canonical temp: (.+)[.]$') { $qa5Roots += $Matches[1] }
  }
}
function Get-Qa5Processes {
  @(Get-CimInstance Win32_Process | Where-Object {
    if (-not $_.ExecutablePath -or $_.CreationDate -lt [datetime]$qa5Baseline.startedAt -or $_.Name -notmatch '^(node|electron|python|wsl|WeftMate|frpc|haproxy)[.]exe$') { return $false }
    $qa5Command = $_.CommandLine.Replace([char]47,[char]92)
    if ($qa5Command -match 'personal-account-20260926|--access-port[= ]18186|llama-server') { return $false }
    @($qa5Roots | Where-Object { $qa5Command.Contains($_.Replace([char]47,[char]92)) }).Count -gt 0
  })
}
$qa5Owned = @(Get-Qa5Processes)
$qa5Stopped = @($qa5Owned | Select-Object ProcessId,Name,CreationDate)
foreach ($qa5Process in $qa5Owned) { Stop-Process -Id $qa5Process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$qa5Remaining = @(Get-Qa5Processes | Select-Object ProcessId,Name,CreationDate)
$qa5Recorded = @()
foreach ($qa5File in Get-ChildItem $qa5Evidence -File -Filter '*cleanup.json' | Where-Object { $_.Name -ne 'cleanup.json' }) {
  try { $qa5Value = Get-Content $qa5File.FullName -Raw | ConvertFrom-Json; $qa5Recorded += @($qa5Value | Where-Object { $_.ProcessId -and $_.CreationDate }) } catch { }
}
$qa5Recorded += $qa5Stopped
$qa5Unique = @($qa5Recorded | Group-Object { [string]$_.ProcessId + '|' + [string]$_.CreationDate } | ForEach-Object { $_.Group[0] })
$qa5Core = @()
$qa5Live = @(Get-CimInstance Win32_Process)
foreach ($qa5Root in $qa5Roots) {
  if ($qa5Root -eq $qa5Repo) { continue }
  $qa5Trace = Join-Path $qa5Root 'trace.jsonl'
  if (-not (Test-Path -LiteralPath $qa5Trace)) { continue }
  foreach ($qa5Line in Get-Content -LiteralPath $qa5Trace) {
    try { $qa5Entry = $qa5Line | ConvertFrom-Json } catch { continue }
    if ($qa5Entry.kind -ne 'core-process') { continue }
    $qa5Match = @($qa5Live | Where-Object { $_.ProcessId -eq $qa5Entry.pid -and $_.Name -eq 'python.exe' -and [math]::Abs(($_.CreationDate.ToUniversalTime() - ([datetime]$qa5Entry.at).ToUniversalTime()).TotalSeconds) -lt 5 })
    $qa5Core += @($qa5Match | Select-Object ProcessId,Name,CreationDate)
  }
}
$qa5Lock = 'D:/AIProjects/WeftMate/Runtime/Orchestrator/lan.lock'
$qa5OwnLock = (Test-Path $qa5Lock) -and ((Get-Content $qa5Lock -Raw) -match '^QA-5 flower')
$qa5Report = [ordered]@{
  at = (Get-Date -Format o)
  criteria = 'creation after baseline start + executable path + command line containing this worktree or recorded QA5 temporary path; no parent-PID matching'
  extraStoppedNow = $qa5Stopped
  uniqueRecordedTerminations = $qa5Unique.Count
  recordedTerminations = $qa5Unique
  remainingOwnedProcesses = $qa5Remaining
  remainingRecordedCoreProcesses = $qa5Core
  backupCopiesRemaining = @(Get-ChildItem $env:TEMP -Directory -Filter 'weftmate-qa5-migration-*').Count
  privateSigningDirectoriesRemaining = @(Get-ChildItem $env:TEMP -Directory -Filter 'weftmate-qa5-signing-*').Count
  ownLanLockRemaining = $qa5OwnLock
  emulatorStarted = $false
  emulatorStopped = $false
  syntheticDirectoryDeletionRejected = 'Seven completed synthetic profile directories retained after automatic approval review rejected deletion: blocked by policy. No alternate deletion attempted.'
}
$qa5Report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $qa5Evidence 'cleanup.json') -Encoding utf8
if ($qa5Remaining.Count -or $qa5Core.Count -or $qa5OwnLock -or $qa5Report.backupCopiesRemaining -or $qa5Report.privateSigningDirectoriesRemaining) { throw 'Cleanup verification incomplete; see cleanup.json' }
