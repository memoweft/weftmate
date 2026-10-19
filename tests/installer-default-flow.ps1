param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Identity,[string]$Out='.local/default-flow')
$ErrorActionPreference='Stop'
if($Identity-notmatch'^[a-z0-9]+$'){throw 'Synthetic installer identity required'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer=(Resolve-Path -LiteralPath $Installer).Path
$Out=[IO.Path]::GetFullPath($(if([IO.Path]::IsPathRooted($Out)){$Out}else{Join-Path $workspace $Out}));[IO.Directory]::CreateDirectory($Out)|Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'helpers/installer-window.cs') -ReferencedAssemblies System.Drawing
$desktop=[InstallerDesktop]::new('DefaultFlow-'+[Guid]::NewGuid().ToString('N'));$owned=0
try {
  # No /D and no /currentuser: run the actual range page, which regenerates
  # electron-builder's default before the custom installation-position page.
  $owned=$desktop.Launch($Installer,'',$workspace)
  $end=(Get-Date).AddSeconds(40);$window=0
  do{$window=$desktop.Find('progress','');if($window){break};Start-Sleep -Milliseconds 100}while((Get-Date)-lt$end)
  if(!$window){throw 'Default position page did not appear'}
  $desktop.Capture($window,(Join-Path $Out 'default-position.png'))
  $text=$desktop.DetailText($window)-join"`n"
  if(!$text.Contains('WM-'+$Identity)){throw 'Range page overwrote the shortened automatic default'}
  'actual-default-flow-shortened=true'
} finally {
  if($window){$desktop.Escape($window)}
  if($owned){$process=Get-Process -Id $owned -ErrorAction SilentlyContinue;if($process-and!$process.WaitForExit(30000)){& taskkill.exe /PID $owned /T /F|Out-Null}}
  $desktop.Dispose()
}
