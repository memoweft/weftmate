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

$existingLinks = @(Get-ChildItem -LiteralPath $root -Recurse -Force -Attributes ReparsePoint)
if ($existingLinks.Count -ne 0) {
  throw "SourceRoot must be link-free before dependency materialization; found $($existingLinks.Count) reparse points"
}

$rootModules = Join-Path $root 'node_modules'
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

$packages = @{}
foreach ($manifest in $manifests) {
  $data = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace([string]$data.name)) {
    $packages[[string]$data.name] = [pscustomobject]@{
      Name = [string]$data.name
      Source = Split-Path -Parent $manifest
      Manifest = $data
    }
  }
}

function PackagePath([string]$base, [string]$name) {
  $segments = $name -split '/'
  if ($segments.Count -eq 2) {
    return Join-Path (Join-Path $base $segments[0]) $segments[1]
  }
  return Join-Path $base $segments[0]
}

$copied = 0
foreach ($pkg in @($packages.Values | Sort-Object Name)) {
  $dependencies = @{}
  foreach ($sectionName in @('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')) {
    $section = $pkg.Manifest.$sectionName
    if ($null -eq $section) { continue }
    foreach ($property in $section.PSObject.Properties) {
      if ([string]$property.Value -like 'workspace:*') {
        $dependencies[$property.Name] = $true
      }
    }
  }
  foreach ($name in @($dependencies.Keys | Sort-Object)) {
    if (-not $packages.ContainsKey($name)) {
      throw "Workspace dependency is not indexed: $($pkg.Name) -> $name"
    }
    $source = PackagePath $rootModules $name
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Materialized root dependency is missing: $source"
    }
    $dest = PackagePath (Join-Path $pkg.Source 'node_modules') $name
    if (Test-Path -LiteralPath $dest) { continue }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    & robocopy.exe $source $dest /E /XD node_modules /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
      throw "robocopy failed for $($pkg.Name) -> ${name}: $LASTEXITCODE"
    }
    $copied += 1
  }
}

$finalLinks = @(Get-ChildItem -LiteralPath $root -Recurse -Force -Attributes ReparsePoint)
if ($finalLinks.Count -ne 0) {
  throw "Materialized tree contains $($finalLinks.Count) reparse points"
}

[pscustomobject]@{
  sourceRoot = $root
  indexedPackages = $packages.Count
  copiedWorkspaceDependencies = $copied
  reparseCount = $finalLinks.Count
} | ConvertTo-Json -Compress
