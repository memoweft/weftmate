param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'
$expectedParent = 'D:\AIProjects\WeftMate\Runtime\Stage4B'
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
if (-not $root.StartsWith($expectedParent + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "SourceRoot must remain below $expectedParent (received $root)"
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'pnpm-lock.yaml'))) {
  throw "SourceRoot is not a DSH source tree: $root"
}

$rootModules = Join-Path $root 'node_modules'
if (-not (Test-Path -LiteralPath $rootModules)) {
  throw "Run the copy-mode pnpm install before materialization: $rootModules"
}
$materializedBase = Join-Path $rootModules '.weftmate-workspace-copies'
$materialized = $materializedBase
$materializedIndex = 1
while (Test-Path -LiteralPath $materialized) {
  $materialized = "$materializedBase-$materializedIndex"
  $materializedIndex += 1
}
New-Item -ItemType Directory -Path $materialized | Out-Null

$manifests = @(
  Get-ChildItem -LiteralPath (Join-Path $root 'vendor') -Directory |
    ForEach-Object { Join-Path $_.FullName 'package.json' } |
    Where-Object { Test-Path -LiteralPath $_ }
  Get-ChildItem -LiteralPath (Join-Path $root 'packages') -Directory |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory } |
    ForEach-Object { Join-Path $_.FullName 'package.json' } |
    Where-Object { Test-Path -LiteralPath $_ }
  Get-ChildItem -LiteralPath (Join-Path $root 'apps') -Directory |
    ForEach-Object { Join-Path $_.FullName 'package.json' } |
    Where-Object { Test-Path -LiteralPath $_ }
  Join-Path $root 'native\landlock-run\package.json'
  Get-ChildItem -LiteralPath (Join-Path $root 'native\landlock-run\packages') -Directory |
    ForEach-Object { Join-Path $_.FullName 'package.json' } |
    Where-Object { Test-Path -LiteralPath $_ }
  Join-Path $root 'website\package.json'
) | Where-Object { Test-Path -LiteralPath $_ }

$packages = @(
  foreach ($manifest in $manifests) {
    $data = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$data.name)) {
      [pscustomobject]@{ Name = [string]$data.name; Source = Split-Path -Parent $manifest }
    }
  }
) | Sort-Object Name -Unique

foreach ($pkg in $packages) {
  $segments = $pkg.Name -split '/'
  $tempDest = if ($segments.Count -eq 2) {
    Join-Path (Join-Path $materialized $segments[0]) $segments[1]
  } else {
    Join-Path $materialized $segments[0]
  }
  New-Item -ItemType Directory -Path $tempDest -Force | Out-Null
  & robocopy.exe $pkg.Source $tempDest /E /XD node_modules /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed for $($pkg.Name): $LASTEXITCODE"
  }
}

$links = @(Get-ChildItem -LiteralPath $root -Recurse -Force -Attributes ReparsePoint |
  Sort-Object { $_.FullName.Length } -Descending)
foreach ($link in $links) {
  if (-not $link.FullName.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Link escaped SourceRoot: $($link.FullName)"
  }
  foreach ($target in @($link.Target)) {
    if ($null -ne $target) {
      $fullTarget = [System.IO.Path]::GetFullPath([string]$target)
      if (-not $fullTarget.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "External link refused: $($link.FullName) -> $fullTarget"
      }
    }
  }
  # Removing a junction without -Recurse removes only the link, never its target.
  Remove-Item -LiteralPath $link.FullName -Force
}

foreach ($pkg in $packages) {
  $segments = $pkg.Name -split '/'
  $tempDest = if ($segments.Count -eq 2) {
    Join-Path (Join-Path $materialized $segments[0]) $segments[1]
  } else {
    Join-Path $materialized $segments[0]
  }
  $dest = if ($segments.Count -eq 2) {
    Join-Path (Join-Path $rootModules $segments[0]) $segments[1]
  } else {
    Join-Path $rootModules $segments[0]
  }
  if (Test-Path -LiteralPath $dest) {
    $existing = Get-Item -LiteralPath $dest -Force
    if (($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Workspace package destination remains a reparse point after link removal: $dest"
    }
    & robocopy.exe $tempDest $dest /E /XD node_modules /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
      throw "robocopy failed while refreshing $($pkg.Name): $LASTEXITCODE"
    }
    continue
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
  Move-Item -LiteralPath $tempDest -Destination $dest
}

$finalLinks = @(Get-ChildItem -LiteralPath $root -Recurse -Force -Attributes ReparsePoint)
if ($finalLinks.Count -ne 0) {
  throw "Materialized tree still contains $($finalLinks.Count) reparse points"
}

[pscustomobject]@{
  sourceRoot = $root
  workspacePackages = $packages.Count
  removedLinks = $links.Count
  reparseCount = $finalLinks.Count
} | ConvertTo-Json -Compress
