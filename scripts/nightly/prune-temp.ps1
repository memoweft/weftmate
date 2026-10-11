#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1, 8760)][int]$Hours = 24,
    # Explicit roots are for isolated tests and reviewed legacy plans, never machine-wide defaults.
    [string[]]$Roots,
    [ValidatePattern('^weftmate-[a-zA-Z0-9-]*$')][string[]]$Prefixes = @('weftmate-'),
    [string]$Repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
    [switch]$Legacy,
    [switch]$Plan,
    [string]$List,
    [string]$Log,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
# Messages are Chinese; a redirected console on CI otherwise falls back to a code page that turns them into '?'.
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding } catch {}
$ownerName = '.weftmate-temp-owner.json'
$cutoff = [DateTimeOffset]::UtcNow.AddHours(-$Hours)
$Legacy = $Legacy -or $Plan -or [bool]$List
function Canonical-Root([string]$path) {
    $full = [IO.Path]::GetFullPath($path)
    $item = Get-Item -LiteralPath $full -Force
    if (-not $item.PSIsContainer) { throw "拒绝清理根（不是目录）：$full" }
    for ($current = $full; $current; $current = [IO.Path]::GetDirectoryName($current.TrimEnd([IO.Path]::DirectorySeparatorChar))) {
        if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "拒绝清理根：根或祖先是联接 / 符号链接：$current"
        }
    }
    # No component can redirect resolution after the ancestor checks.
    $real = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $full).ProviderPath)
    if ($real -eq [IO.Path]::GetPathRoot($real)) { return $real }
    return $real.TrimEnd([IO.Path]::DirectorySeparatorChar)
}
function Safe-Target([string]$target, [string]$root) {
    $verified = Canonical-Root $root
    if ($verified -ine $root) { throw '清理根真实路径已变化' }
    try { $item = Get-Item -LiteralPath $target -Force }
    catch { if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $null }; throw }
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "拒绝目标：不是普通目录或自身是联接：$target" }
    try { $real = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $target).ProviderPath) }
    catch { if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $null }; throw }
    if ([IO.Path]::GetDirectoryName($real) -ine $root -or $item.Name -ieq 'weftmate-temp' -or
        -not ($Prefixes | Where-Object { $item.Name.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { throw "拒绝目标：真实父目录越界：$target" }
    return $item
}
function Process-Table {
    $previousError = $Error | Select-Object -First 1
    $rows = @(Get-CimInstance Win32_Process -OperationTimeoutSec 10 -ErrorAction Stop)
    if ($Error.Count -and -not [object]::ReferenceEquals($previousError, $Error[0])) { throw '系统进程查询报错；未执行删除' }
    if (-not ($rows | Where-Object { $_.ProcessId -eq $PID -and $_.CreationDate })) {
        throw '系统进程查询不完整（当前清理进程不在表里）；未执行删除'
    }
    return ,$rows
}
function Iso([datetime]$time) { return $time.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Owner-Exists([string]$target) {
    # Enumeration also sees a dangling owner symlink; it is invalid, not absent.
    try { return [bool]@(Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -ceq $ownerName }).Count }
    catch { if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { return $false }; throw }
}
function Read-Owner([string]$target) {
    $file = Join-Path $target $ownerName
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try {
        $stat = Get-Item -LiteralPath $file -Force
        if ($stat.PSIsContainer -or ($stat.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
        $document = [System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($file))
        try {
            $json = $document.RootElement
            $owner = [ordered]@{schemaVersion=$json.GetProperty('schemaVersion').GetInt32();pid=$json.GetProperty('pid').GetInt32();processStartedAt=$json.GetProperty('processStartedAt').GetString();createdAt=$json.GetProperty('createdAt').GetString();heartbeatAt=$json.GetProperty('heartbeatAt').GetString();id=$json.GetProperty('id').GetString()}
        } finally { $document.Dispose() }
        if ($owner.schemaVersion -ne 1 -or $owner.pid -isnot [long] -and $owner.pid -isnot [int] -or $owner.pid -le 0 -or $owner.pid -gt 2147483647 -or
            $owner.id -isnot [string] -or $owner.id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { return $null }
        foreach ($key in @('processStartedAt', 'createdAt', 'heartbeatAt')) {
            if ($owner.$key -isnot [string] -or $owner.$key -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { return $null }
            $parsed = [DateTimeOffset]::ParseExact($owner.$key, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
            if ($parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") -cne $owner.$key) { return $null }
        }
        if ([DateTimeOffset]$owner.processStartedAt -gt [DateTimeOffset]$owner.createdAt -or [DateTimeOffset]$owner.createdAt -gt [DateTimeOffset]$owner.heartbeatAt) { return $null }
        return $owner
    } catch { return $null }
}
function Owner-Live($owner, $rows) {
    $row = $rows | Where-Object { $_.ProcessId -eq $owner.pid } | Select-Object -First 1
    return $row -and (-not $row.CreationDate -or (Iso $row.CreationDate) -ceq $owner.processStartedAt)
}
function Bytes-NoFollow([string]$target) {
    [long]$size = 0
    foreach ($item in Get-ChildItem -LiteralPath $target -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($item.PSIsContainer) { $size += Bytes-NoFollow $item.FullName } else { $size += $item.Length }
    }
    return $size
}
function Remove-NoFollow([string]$target) {
    $item = Get-Item -LiteralPath $target -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        # Non-recursive removal unlinks the reparse point, never its destination.
        Remove-Item -LiteralPath $target -Force
        return
    }
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $target -Force) { Remove-NoFollow $child.FullName }
    }
    Remove-Item -LiteralPath $target -Force
}
function Hold-DeletionFiles([string]$target, $handles) {
    foreach ($item in Get-ChildItem -LiteralPath $target -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($item.PSIsContainer) { Hold-DeletionFiles $item.FullName $handles }
        else {
            # Keep exclusive read/write exclusion through deletion, permitting only delete sharing.
            $handle = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
            $handles.Add($handle)
        }
    }
}
function Audit($record) {
    $line = ConvertTo-Json -InputObject $record -Depth 8 -Compress
    if ($Log) { Add-Content -LiteralPath $Log -Value $line -Encoding utf8 -ErrorAction Stop }
    Write-Output $line
}
try {
    if ($Plan -and $Apply) { throw '-Plan 与 -Apply 不能一起使用' }
    if ($Legacy -and -not $List) { throw '历史清理必须用 -Plan -List <文件> 或 -Apply -List <文件>；没有清单不删除' }
    if ($Legacy -and -not $Plan -and -not $Apply) { throw '历史清理必须指定 -Plan 或 -Apply' }
    $manifest = $null
    if ($Legacy -and $Apply) {
        $manifest = Get-Content -LiteralPath $List -Raw | ConvertFrom-Json
        foreach ($listedItem in $manifest.items) {
            foreach ($timeKey in @('createdAt','lastWriteTime')) { if ($listedItem.$timeKey -is [datetime]) { $listedItem.$timeKey = Iso $listedItem.$timeKey } }
        }
        if ($manifest.schemaVersion -ne 1 -or $manifest.mode -cne 'legacy' -or -not $manifest.roots -or $null -eq $manifest.items) { throw '无效的历史清理清单' }
        if ($manifest.hours -isnot [int] -and $manifest.hours -isnot [long] -or $manifest.hours -lt 1 -or $manifest.hours -gt 8760) { throw '清单门槛无效' }
        $Hours = $manifest.hours
        $cutoff = [DateTimeOffset]::UtcNow.AddHours(-$Hours)
        if ($Roots) { throw '-Apply -List 的根只来自已审阅清单，不接受另传 -Roots' }
        $Roots = @($manifest.roots)
    }
    if ($Legacy -and $Plan -and -not $Roots) { throw '历史预览必须显式指定 -Roots（不会扫描默认系统目录）' }
    if (-not $Roots) {
        $Roots = @((Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot ?? 'C:\Windows')) 'weftmate-temp'))
    }
    # Verify all roots before enumerating any of them or deleting anything.
    $verifiedRoots = @()
    foreach ($root in ($Roots | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $root)) { if ($Legacy) { throw "清单根不存在：$root" }; continue }
        $verifiedRoots += Canonical-Root $root
    }
    $processes = Process-Table
    $worktreeOutput = @(git -C $Repository worktree list --porcelain 2>$null)
    if ($LASTEXITCODE -ne 0) { throw '无法查询已登记工作树；未执行删除' }
    $worktrees = @($worktreeOutput | Where-Object { $_ -like 'worktree *' } | ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)) })
    $summary = [ordered]@{ hours=$Hours; mode=if ($Legacy) {'legacy'} else {'managed'}; applied=[bool]$Apply; found=0; selected=0; deleted=0; failed=0; keptRecent=0; keptInUse=0; keptWorktrees=0; keptUnowned=0; keptUnsafe=0; unowned=@(); entries=@() }
    $selected = @()
    foreach ($root in $verifiedRoots) {
        $dirs = if ($manifest) {
            @($manifest.items | Where-Object { $_.root -ieq $root } | ForEach-Object {
                if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($_.path)) -ine $root) { throw '清单目标不是根的直接子目录' }
                Get-Item -LiteralPath $_.path -Force
            })
        } else { @(Get-ChildItem -LiteralPath $root -Directory -Filter 'weftmate-*' -Force) }
        foreach ($dir in $dirs) {
            if ($dir.Name -ieq 'weftmate-temp' -or -not ($Prefixes | Where-Object { $dir.Name.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { continue }
            $summary.found++
            if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { $summary.keptUnsafe++; continue }
            if (-not (Safe-Target $dir.FullName $root)) { $summary.keptUnsafe++; continue }
            if ($worktrees | Where-Object { $_ -ieq $dir.FullName -or $_.StartsWith($dir.FullName + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $dir.FullName.StartsWith($_ + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) }) { $summary.keptWorktrees++; continue }
            $owner = Read-Owner $dir.FullName
            $ownerExists = if ($owner) { $true } else { Owner-Exists $dir.FullName }
            if (-not $owner) {
                $summary.keptUnowned++; $summary.unowned += @{directory=$dir.Name;root=$root;reason=if ($ownerExists) {'invalid ownership'} else {'missing ownership'}}
                if (-not $Legacy -or $ownerExists) { continue }
            } elseif ($Legacy) { $summary.keptInUse++; continue }
            if ($owner -and (Owner-Live $owner $processes)) { $summary.keptInUse++; continue }
            if ($owner) {
                if ([DateTimeOffset]$owner.heartbeatAt -ge $cutoff) { $summary.keptRecent++; continue }
            } else {
                if ($dir.CreationTimeUtc -ge $cutoff.UtcDateTime -or $dir.LastWriteTimeUtc -ge $cutoff.UtcDateTime) { $summary.keptRecent++; continue }
                if ($processes | Where-Object { $_.CommandLine -and ($_.CommandLine.IndexOf($dir.FullName, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine.IndexOf(($dir.FullName -replace '\\','/'), [StringComparison]::OrdinalIgnoreCase) -ge 0) }) { $summary.keptInUse++; continue }
            }
            $bytes = Bytes-NoFollow $dir.FullName
            $record = [ordered]@{directory=$dir.Name;path=$dir.FullName;root=$root;bytes=$bytes;createdAt=(Iso $dir.CreationTimeUtc);lastWriteTime=(Iso $dir.LastWriteTimeUtc);owner=$owner;result='selected'}
            if ($manifest) {
                $listed = @($manifest.items | Where-Object { $_.path -ceq $dir.FullName -and $_.root -ceq $root })
                if ($listed.Count -ne 1 -or $listed[0].bytes -ne $bytes -or $listed[0].createdAt -cne $record.createdAt -or $listed[0].lastWriteTime -cne $record.lastWriteTime) { $summary.keptUnsafe++; continue }
            }
            $selected += $record
        }
    }
    if ($manifest -and @($manifest.items | Where-Object { $_.root -notin $verifiedRoots }).Count) { throw '清单中有未经验证的根' }
    $summary.selected = $selected.Count
    if ($Plan) {
        @{schemaVersion=1;mode='legacy';hours=$Hours;plannedAt=[DateTimeOffset]::UtcNow.ToString('o');roots=$verifiedRoots;items=@($selected | ForEach-Object { @{path=$_.path;root=$_.root;bytes=$_.bytes;createdAt=$_.createdAt;lastWriteTime=$_.lastWriteTime} })} |
            ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $List -Encoding utf8
        foreach ($entry in $selected) { Audit $entry }
    } elseif ($Apply) {
        # Both required snapshots must succeed before the first deletion.
        $freshProcesses = Process-Table
        foreach ($entry in $selected) {
            $handles = [Collections.Generic.List[IO.FileStream]]::new()
            try {
                $dir = Safe-Target $entry.path $entry.root
                if (-not $dir) { $entry.result='keptGone'; $summary.keptUnsafe++; Audit $entry; continue }
                $owner = Read-Owner $entry.path
                if ($entry.owner) {
                    if (-not $owner -or (ConvertTo-Json -InputObject $owner -Compress) -cne (ConvertTo-Json -InputObject $entry.owner -Compress) -or (Owner-Live $owner $freshProcesses) -or [DateTimeOffset]$owner.heartbeatAt -ge $cutoff) {
                        $entry.result='keptChanged'; $summary.keptInUse++; Audit $entry; continue
                    }
                    # An orphan consumer may outlive its lease writer. The observed open-file
                    # counterexample must stay safe even for an expired registered directory.
                    try { Hold-DeletionFiles $entry.path $handles }
                    catch { $entry.result='keptOpenHandles'; $summary.keptInUse++; Audit $entry; continue }
                } else {
                    if (Owner-Exists $entry.path) { throw '历史目标现在已有归属记录，保留' }
                    if ((Iso $dir.CreationTimeUtc) -cne $entry.createdAt -or (Iso $dir.LastWriteTimeUtc) -cne $entry.lastWriteTime -or (Bytes-NoFollow $entry.path) -ne $entry.bytes) { throw '历史目标在清单之后发生变化，保留' }
                    if ($freshProcesses | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($entry.path) -or $_.CommandLine.Contains(($entry.path -replace '\\','/'))) }) { throw '历史目标有活动进程引用，保留' }
                    Hold-DeletionFiles $entry.path $handles
                }
                $entry.result='deleting'; Audit $entry
                if (-not (Safe-Target $entry.path $entry.root)) { $entry.result='keptGone'; $summary.keptUnsafe++; Audit $entry; continue }
                Remove-NoFollow $entry.path
                $entry.result='deleted'; $summary.deleted++
            } catch {
                $entry.result='failed'; $entry.error=$_.Exception.Message; $summary.failed++
            } finally { foreach ($handle in $handles) { $handle.Dispose() } }
            Audit $entry
            $summary.entries += $entry
        }
    }
    Audit $summary
    if ($summary.failed) { throw '逐项目录安全检查或删除失败；见逐项日志' }
} catch {
    throw ("清理已停止，未继续删除：" + $_.Exception.Message)
}
