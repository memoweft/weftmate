# Read/capture only the synthetic WeftMate toast. Never send mouse/keyboard input.
param([string]$Output, [string]$Body = '想要运行一条命令')
trap { @{captured=$false; errorCode=$_.FullyQualifiedErrorId} | ConvertTo-Json -Compress; exit 3 }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Sys3CaptureDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][Sys3CaptureDpi]::SetProcessDPIAware()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$matches = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name.Contains($Body) })
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
foreach ($match in $matches) {
  $node = $match
  $candidate = $null
  for ($i = 0; $i -lt 8 -and $node; $i++) {
    $bounds = $node.Current.BoundingRectangle
    if ($bounds.Width -gt 850 -or $bounds.Height -gt 550) { break }
    if ($bounds.Width -ge 280 -and $bounds.Height -ge 100) {
      $names = @($node.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })
      # Windows may show productName (WeftMate) rather than the isolated shortcut name.
      # Exact synthetic body + action labels identify this test's notification.
      if (($names -match 'sys3qa|WeftMate').Count -gt 0 -and ($names -contains '允许' -or $names -contains '查看')) { $candidate = $node; break }
    }
    $node = $walker.GetParent($node)
  }
  if ($candidate) {
    $rect = $candidate.Current.BoundingRectangle
    if ($rect.X -lt 0 -or $rect.Y -lt 0) { continue }
    $bitmap = [System.Drawing.Bitmap]::new([int]$rect.Width, [int]$rect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, $bitmap.Size)
      $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
      @{captured=$true; syntheticToastOnly=$true; width=$bitmap.Width; height=$bitmap.Height} | ConvertTo-Json -Compress
      exit 0
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
}
@{captured=$false; matchingBodies=$matches.Count; reason='Synthetic toast is not currently visible under the current Windows notification settings.'} | ConvertTo-Json -Compress
exit 2
