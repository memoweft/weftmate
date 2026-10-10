[CmdletBinding()]
param(
    [ValidateRange(1, 240)][int]$MaxMinutes = 90,
    [ValidateRange(0, 1)][double]$DiffThreshold = 0.08,
    [string]$Worktree = 'D:\AIProjects\WeftMate\Worktrees\nightly',
    [string]$ReportRoot = 'D:\AIProjects\WeftMate\Runtime\Nightly',
    [string]$Orchestrator = 'D:\AIProjects\WeftMate\Runtime\Orchestrator',
    [string]$MacHost = 'mac',
    # Validation before merge: use the current package commit in both dedicated trees.
    [switch]$Candidate,
    [switch]$SkipApple,
    [switch]$SkipAndroid
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runner = Join-Path $PSScriptRoot 'run.mjs'
$arguments = @($runner, '--repository', $repository, '--worktree', $Worktree, '--reports', $ReportRoot,
    '--orchestrator', $Orchestrator, '--mac', $MacHost, '--minutes', "$MaxMinutes", '--threshold', "$DiffThreshold")
if ($Candidate) { $arguments += '--candidate' }
if ($SkipApple) { $arguments += '--skip-apple' }
if ($SkipAndroid) { $arguments += '--skip-android' }
# Node owns the deadline, phase logs, finally cleanup and report even after a failure.
& node @arguments
exit $LASTEXITCODE
