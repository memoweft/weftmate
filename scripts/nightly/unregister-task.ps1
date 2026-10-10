[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
if ($PSCmdlet.ShouldProcess('WeftMate Nightly Regression', 'Unregister task')) {
    Unregister-ScheduledTask -TaskName 'WeftMate Nightly Regression' -Confirm:$false -ErrorAction SilentlyContinue
}
