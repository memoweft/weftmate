param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$UpgradeInstaller,[string]$Out='tests/evidence/inst-1')
$ErrorActionPreference='Stop'
# Retain the original entry point while exercising the current one-page UI.
& (Join-Path $PSScriptRoot 'inst-1-frame.ps1') -Installer $Installer -Out $Out
& (Join-Path $PSScriptRoot 'inst-1b-interactive.ps1') -Installer $Installer -UpgradeInstaller $UpgradeInstaller -Out $Out -Mode both -Watchdog
