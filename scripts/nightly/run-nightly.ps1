[CmdletBinding()]
param(
    [ValidateRange(1, 240)][int]$MaxMinutes = 90,
    [ValidateRange(0, 1)][double]$DiffThreshold = 0.08,
    [Parameter(Mandatory)][string]$Worktree,
    [Parameter(Mandatory)][string]$ReportRoot,
    [Parameter(Mandatory)][string]$Orchestrator,
    [string]$MacHost = 'mac',
    # Validation before merge: use the current package commit in both dedicated trees.
    [switch]$Candidate,
    [switch]$SkipApple,
    [switch]$SkipAndroid,
    [switch]$DevicesOnly,
    [string]$Phases,
    [string]$Scene
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runner = Join-Path $PSScriptRoot 'run.mjs'
$arguments = @($runner, '--repository', $repository, '--worktree', $Worktree, '--reports', $ReportRoot,
    '--orchestrator', $Orchestrator, '--mac', $MacHost, '--minutes', "$MaxMinutes", '--threshold', "$DiffThreshold")
if ($Candidate) { $arguments += '--candidate' }
if ($SkipApple) { $arguments += '--skip-apple' }
if ($SkipAndroid) { $arguments += '--skip-android' }
if ($DevicesOnly) { $arguments += '--devices-only' }
if ($Phases) { $arguments += @('--phases', $Phases) }
if ($Scene) { $arguments += @('--scene', $Scene) }
# Stable Node bootstrap owns the global lock; tested engine owns deadline, phases and cleanup.
& node @arguments
exit $LASTEXITCODE
