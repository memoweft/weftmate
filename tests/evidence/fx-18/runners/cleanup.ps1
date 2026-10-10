$ErrorActionPreference = 'Stop'
$fx18Repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$fx18Evidence = Join-Path $fx18Repo 'tests/evidence/fx-18'
$fx18Started = (Get-Item (Join-Path $fx18Evidence 'baseline/run-root.txt')).CreationTime
$fx18Final = Get-Content (Join-Path $fx18Evidence 'exit-serial-final/results.json') -Raw | ConvertFrom-Json
if (-not $fx18Final.finishedAt) { throw 'The final matrix must finish before cleanup' }
$fx18Roots = @($fx18Repo, 'D:\AIProjects\MemoWeft\Worktrees\fx-18-formation-recovery')
foreach ($fx18File in Get-ChildItem $fx18Evidence -Recurse -File -Filter 'run-root.txt') {
  $fx18Path = (Get-Content -LiteralPath $fx18File.FullName -Raw).Trim()
  if ([IO.Path]::IsPathRooted($fx18Path) -and [IO.Path]::GetFileName($fx18Path) -like 'weftmate-fx18-*') { $fx18Roots += [IO.Path]::GetFullPath($fx18Path) }
}
foreach ($fx18Line in Get-Content (Join-Path $fx18Evidence 'required-unit-tests.txt') -TotalCount 4) {
  if ($fx18Line -match 'isolated canonical temp: (.+)[.]$') { $fx18Roots += $Matches[1] }
}
function Test-Fx18Owned($fx18Process) {
  if (-not $fx18Process.ExecutablePath -or $fx18Process.CreationDate -lt $fx18Started -or $fx18Process.Name -notmatch '^(node|electron|python|wsl)[.]exe$') { return $false }
  $fx18Command = ([string]$fx18Process.CommandLine).Replace([char]47,[char]92)
  if ($fx18Command -match 'personal-account-20260926|--access-port[= ]18186|llama-server') { return $false }
  return @($fx18Roots | Where-Object { $fx18Command.Contains($_.Replace([char]47,[char]92)) }).Count -gt 0
}
$fx18Stopped = @()
foreach ($fx18Process in @(Get-CimInstance Win32_Process | Where-Object { Test-Fx18Owned $_ })) {
  $fx18Current = Get-CimInstance Win32_Process -Filter "ProcessId=$($fx18Process.ProcessId)"
  if ($fx18Current -and $fx18Current.CreationDate -eq $fx18Process.CreationDate -and (Test-Fx18Owned $fx18Current)) {
    Stop-Process -Id $fx18Current.ProcessId -Force -ErrorAction SilentlyContinue
    $fx18Stopped += $fx18Current | Select-Object ProcessId,Name,CreationDate
  }
}
Start-Sleep -Seconds 2
$fx18Live = @(Get-CimInstance Win32_Process)
$fx18Core = @(); $fx18Tracked = 0
foreach ($fx18Root in $fx18Roots) {
  $fx18Trace = Join-Path $fx18Root 'trace.jsonl'
  if (-not (Test-Path -LiteralPath $fx18Trace)) { continue }
  foreach ($fx18Line in Get-Content -LiteralPath $fx18Trace) {
    try { $fx18Entry = $fx18Line | ConvertFrom-Json } catch { continue }
    if ($fx18Entry.kind -ne 'core-process') { continue }; $fx18Tracked++
    $fx18Core += @($fx18Live | Where-Object { $_.ProcessId -eq $fx18Entry.pid -and $_.Name -eq 'python.exe' -and [math]::Abs(($_.CreationDate.ToUniversalTime() - ([datetime]$fx18Entry.at).ToUniversalTime()).TotalSeconds) -lt 5 } | Select-Object ProcessId,Name,CreationDate)
  }
}
$fx18Report = [ordered]@{
  at=(Get-Date -Format o); startedAt=$fx18Started.ToUniversalTime().ToString('o')
  criteria='creation after this package baseline fixture + executable path + command line containing this worktree or its recorded synthetic roots; no parent PID matching'
  stopped=$fx18Stopped; stoppedCount=$fx18Stopped.Count
  remainingOwnedProcesses=@($fx18Live | Where-Object { Test-Fx18Owned $_ } | Select-Object ProcessId,Name,CreationDate)
  recordedCoreProcessCount=$fx18Tracked; remainingRecordedCoreProcesses=$fx18Core
  emulatorStarted=$false; realModelRequests=0
}
$fx18Report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $fx18Evidence 'cleanup.json')
$fx18Report | ConvertTo-Json -Depth 8
