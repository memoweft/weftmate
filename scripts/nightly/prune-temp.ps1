#Requires -Version 7.0
# Deletion relies on PowerShell 7 removing junctions as links. Windows PowerShell 5.1 may descend into
# a junction target with Remove-Item -Recurse, so this script refuses to run there.
[CmdletBinding()]
param(
    [ValidateRange(1, 8760)][int]$Hours = 24,
    # Test seam: explicit roots replace the machine defaults.
    [string[]]$Roots,
    # Prefixes, not arbitrary globs: permits the approved one-off legacy cleanup.
    [ValidatePattern('^weftmate-[a-zA-Z0-9-]*$')][string[]]$Prefixes = @('weftmate-'),
    [string]$Repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [switch]$Apply
)
$ErrorActionPreference = 'Continue'
# Owner-approved housekeeping (2026-10-10): synthetic test runs leave `weftmate-*`
# directories under the temp roots. Only stale, unused, non-worktree directories go.
$cutoff = (Get-Date).AddHours(-$Hours)
if (-not $Roots) { $Roots = @($env:TEMP, 'C:\Temp', 'C:\', 'C:\weftmate-temp') }
$Roots = @($Roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
# Registered git worktrees are removed with `git worktree remove`, never here.
$worktrees = @(git -C $Repository worktree list --porcelain 2>$null |
    Where-Object { $_ -like 'worktree *' } |
    ForEach-Object { ($_ -replace '^worktree ', '') -replace '/', '\' })
$processes = @(Get-CimInstance Win32_Process)
$commandLines = ($processes | ForEach-Object { $_.CommandLine }) -join "`n"
$selected = @(); $recent = 0; $inUse = 0; $worktree = 0; $total = 0
foreach ($root in $Roots) {
    # Never enumerate through a root junction; all deletion targets remain immediate children.
    if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    foreach ($dir in Get-ChildItem -LiteralPath $root -Directory -Filter 'weftmate-*' -Force -ErrorAction SilentlyContinue) {
        # The shared parent is a container, not a disposable fixture.
        if ($dir.Name -ieq 'weftmate-temp' -or -not ($Prefixes | Where-Object { $dir.Name.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { continue }
        $total++
        if ($worktrees | Where-Object { $_ -ieq $dir.FullName }) { $worktree++; continue }
        if ($dir.CreationTime -ge $cutoff -or $dir.LastWriteTime -ge $cutoff) { $recent++; continue }
        # PowerShell expands Windows 8.3 components during enumeration, while
        # a process can still name this directory through the supplied TEMP root.
        $references = @($dir.FullName, (Join-Path $root $dir.Name))
        $used = $false
        # A worker may use a fixture without naming it on its command line.
        # Any live owner PID is protected (PID reuse conservatively keeps it).
        if (-not ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $ownerFile = Join-Path $dir.FullName '.weftmate-temp-owner.json'
            if (Test-Path -LiteralPath $ownerFile) {
                try {
                    $owner = Get-Content -LiteralPath $ownerFile -Raw | ConvertFrom-Json
                    if ($processes | Where-Object { $_.ProcessId -eq $owner.pid }) { $used = $true }
                } catch { $used = $true } # malformed ownership is not permission to delete
            }
        }
        foreach ($reference in $references) {
            $forward = $reference -replace '\\', '/'
            if ($commandLines.IndexOf($reference, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $commandLines.IndexOf($forward, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $used = $true; break }
        }
        if ($used) { $inUse++; continue }
        $selected += @{ directory = $dir; root = [IO.Path]::GetFullPath((Get-Item -LiteralPath $root).FullName) }
    }
}
$deleted = 0; $failed = 0
if ($Apply) {
    foreach ($entry in $selected) {
        $target = [IO.Path]::GetFullPath($entry.directory.FullName)
        # Keep discovery, boundary verification and deletion in PowerShell.
        # PowerShell 7 removes junctions as links rather than traversing them.
        if ([IO.Path]::GetDirectoryName($target).TrimEnd('\') -ine $entry.root.TrimEnd('\') -or
            [IO.Path]::GetFileName($target) -ieq 'weftmate-temp' -or
            -not ($Prefixes | Where-Object { [IO.Path]::GetFileName($target).StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { $failed++; continue }
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $target) { $failed++ } else { $deleted++ }
    }
}
@{ hours = $Hours; applied = [bool]$Apply; found = $total; selected = $selected.Count; deleted = $deleted; failed = $failed
   keptRecent = $recent; keptInUse = $inUse; keptWorktrees = $worktree } | ConvertTo-Json -Compress
