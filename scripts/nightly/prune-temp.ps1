[CmdletBinding()]
param(
    [ValidateRange(1, 8760)][int]$Hours = 48,
    # Test seam: explicit roots replace the machine defaults.
    [string[]]$Roots,
    [string]$Repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [switch]$Apply
)
$ErrorActionPreference = 'Continue'
# Owner-approved housekeeping (2026-10-10): synthetic test runs leave `weftmate-*`
# directories under the temp roots. Only stale, unused, non-worktree directories go.
$cutoff = (Get-Date).AddHours(-$Hours)
if (-not $Roots) { $Roots = @($env:TEMP, 'C:\Temp', 'C:\') }
$Roots = @($Roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
# Registered git worktrees are removed with `git worktree remove`, never here.
$worktrees = @(git -C $Repository worktree list --porcelain 2>$null |
    Where-Object { $_ -like 'worktree *' } |
    ForEach-Object { ($_ -replace '^worktree ', '') -replace '/', '\' })
$commandLines = (Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }) -join "`n"
$selected = @(); $recent = 0; $inUse = 0; $worktree = 0; $total = 0
foreach ($root in $Roots) {
    foreach ($dir in Get-ChildItem -LiteralPath $root -Directory -Filter 'weftmate-*' -Force -ErrorAction SilentlyContinue) {
        $total++
        if ($worktrees | Where-Object { $_ -ieq $dir.FullName }) { $worktree++; continue }
        if ($dir.CreationTime -ge $cutoff -or $dir.LastWriteTime -ge $cutoff) { $recent++; continue }
        $forward = $dir.FullName -replace '\\', '/'
        if ($commandLines.IndexOf($dir.FullName, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $commandLines.IndexOf($forward, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $inUse++; continue }
        $selected += $dir
    }
}
$deleted = 0; $failed = 0
if ($Apply) {
    foreach ($dir in $selected) {
        # rd /s removes junctions as links and never descends into their targets.
        cmd /c "rd /s /q `"\\?\$($dir.FullName)`"" 2>$null | Out-Null
        if (Test-Path -LiteralPath $dir.FullName) { $failed++ } else { $deleted++ }
    }
}
@{ hours = $Hours; applied = [bool]$Apply; found = $total; selected = $selected.Count; deleted = $deleted; failed = $failed
   keptRecent = $recent; keptInUse = $inUse; keptWorktrees = $worktree } | ConvertTo-Json -Compress
