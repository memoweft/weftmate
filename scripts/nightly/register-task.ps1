[CmdletBinding(SupportsShouldProcess)]
param([string]$Script = (Join-Path $PSScriptRoot 'run-nightly.ps1'), [int]$MaxMinutes = 90)
$ErrorActionPreference = 'Stop'
$scriptPath = (Resolve-Path -LiteralPath $Script).Path
$pwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $pwshPath -Argument "-NoProfile -WindowStyle Hidden -File `"$scriptPath`" -MaxMinutes $MaxMinutes" -WorkingDirectory (Split-Path $scriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
# Interactive user required for Electron/native screenshots and desktop notifications.
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes ($MaxMinutes + 5)) -MultipleInstances IgnoreNew
# Default settings: DisallowStartIfOnBatteries=true, StopIfGoingOnBatteries=true.
if ($PSCmdlet.ShouldProcess('WeftMate Nightly Regression', 'Register current-user daily AC-only task')) {
    Register-ScheduledTask -TaskName 'WeftMate Nightly Regression' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Synthetic five-end nightly screenshots; isolated worktrees; 14-day local reports' -Force
}
