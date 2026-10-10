param([Parameter(Mandatory)][string]$Since, [Parameter(Mandatory)][string]$RootsJson, [int]$OwnerPid = 0, [int]$BootstrapPid = 0)
$ErrorActionPreference = 'Stop'
$started = [datetime]::Parse($Since).ToUniversalTime()
$roots = @(Get-Content -LiteralPath $RootsJson -Raw | ConvertFrom-Json)
$killed = @()
# 4c: timestamp + executable + command path, never a parent-PID tree.
foreach ($process in Get-CimInstance Win32_Process) {
    if ($process.ProcessId -in @($OwnerPid, $BootstrapPid)) { continue }
    if (!$process.CreationDate -or $process.CreationDate.ToUniversalTime() -lt $started) { continue }
    if (!$process.ExecutablePath -or !$process.CommandLine) { continue }
    if ([IO.Path]::GetFileName($process.ExecutablePath) -notmatch '^(node|electron|WeftMate|adb|python|python3|java|chrome|chrome-headless-shell|pwsh|powershell|wsl)\.exe$') { continue }
    $matchesRoot = $false
    foreach ($root in $roots) {
        $rootPattern = [regex]::Escape($root.Replace('\', '/')) + '(?=[/\s"'']|$)'
        if ([regex]::IsMatch($process.CommandLine.Replace('\', '/'), $rootPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { $matchesRoot = $true }
    }
    if (!$matchesRoot -or $process.ProcessId -eq $PID) { continue }
    # Re-read to reject an exited/reused PID between enumeration and termination.
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
    if ($current -and $current.CreationDate -eq $process.CreationDate -and $current.ExecutablePath -eq $process.ExecutablePath -and $current.CommandLine -eq $process.CommandLine) {
        Stop-Process -Id $current.ProcessId -Force -ErrorAction SilentlyContinue
        $killed += $current.ProcessId
    }
}
@{ killed = $killed; count = $killed.Count } | ConvertTo-Json -Compress
