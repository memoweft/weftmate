param([Parameter(Mandatory)][string]$StatusPath, [Parameter(Mandatory)][string]$ReceiptPath)
$ErrorActionPreference = 'Stop'
$status = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = [System.Windows.Forms.NotifyIcon]::new()
try {
    $icon.Icon = [System.Drawing.SystemIcons]::Warning
    $icon.Text = 'WeftMate 夜间回归'
    $icon.Visible = $true
    $icon.ShowBalloonTip(5000, 'WeftMate 夜间回归报警', "$($status.alerts.Count) 项异常，请查看 nightly-report.md。", [System.Windows.Forms.ToolTipIcon]::Warning)
    # Keep the transient notification icon alive long enough for Explorer to show it.
    $until = [datetime]::UtcNow.AddSeconds(5)
    while ([datetime]::UtcNow -lt $until) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    @{ requestedAt = [datetime]::UtcNow.ToString('o'); supported = $true; channel = 'Windows NotifyIcon balloon'; alerts = $status.alerts.Count } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptPath -Encoding utf8
} finally { $icon.Dispose() }
