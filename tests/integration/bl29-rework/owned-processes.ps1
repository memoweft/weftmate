param([string]$Action, [string]$Root, [int]$ProcessId = 0)
$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($Root)
if ([IO.Path]::GetFileName($resolvedRoot) -notlike 'weftmate-*') { throw 'Unexpected owned test root' }
$owned = Get-Content -LiteralPath (Join-Path $resolvedRoot 'ownership.json') -Raw | ConvertFrom-Json
if ($owned.root -ne $resolvedRoot) { throw 'Ownership root mismatch' }
$started = [DateTimeOffset]::Parse($owned.startedAt).UtcDateTime
function Identity($p) {
  try { return @{pid=$p.Id;createdAt=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path} } catch { return $null }
}
if ($Action -eq 'register') {
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($p) { Identity $p | ConvertTo-Json -Compress }
  exit
}
if ($Action -eq 'resources') {
  $memory = $null
  try {
    $samples=(Get-Counter '\Memory\Committed Bytes','\Memory\Commit Limit').CounterSamples
    $memory=@{committedBytes=$samples[0].CookedValue;limitBytes=$samples[1].CookedValue}
  } catch { $memory=@{error='Memory counters unavailable'} }
  $states=@{}
  # Only aggregate counts leave this process; no addresses or machine names.
  & netstat -an -p tcp | ForEach-Object {
    if ($_ -match '^\s*TCP\s+\S+\s+\S+\s+(\S+)') { $states[$Matches[1]]++ }
  }
  @{at=[DateTime]::UtcNow.ToString('o');memory=$memory;tcp=$states} | ConvertTo-Json -Compress -Depth 5
  exit
}
$rows=@()
# Use Get-Process for executable/creation details. Windows does not expose
# command lines there; query that one field only for already matched PIDs.
foreach ($p in @(Get-Process -Name node,electron -ErrorAction SilentlyContinue)) {
  $identity=Identity $p
  if (!$identity -or $p.StartTime.ToUniversalTime() -lt $started -or $owned.executables -notcontains $identity.executable) { continue }
  $line=(Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -Property CommandLine -ErrorAction SilentlyContinue).CommandLine
  if (!$line -or !$line.Contains($resolvedRoot)) { continue }
  $rows += $identity
}
if ($Action -eq 'cleanup') {
  $killed=@()
  foreach ($row in $rows) {
    # Reacquire and compare all three properties immediately before stopping.
    $p=Get-Process -Id $row.pid -ErrorAction SilentlyContinue
    if (!$p) { continue }
    $again=Identity $p
    if (!$again -or $again.createdAt -ne $row.createdAt -or $again.executable -ne $row.executable) { continue }
    $line=(Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -Property CommandLine -ErrorAction SilentlyContinue).CommandLine
    if (!$line -or !$line.Contains($resolvedRoot)) { continue }
    Stop-Process -Id $row.pid -Force -ErrorAction SilentlyContinue
    $null=$p.WaitForExit(5000)
    $killed += $row.pid
  }
  @{matched=$rows.Count;checked=$rows;killed=$killed} | ConvertTo-Json -Compress -Depth 4
} else { ConvertTo-Json -InputObject @($rows) -Compress -Depth 4 }
