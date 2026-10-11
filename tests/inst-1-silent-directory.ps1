param([Parameter(Mandatory=$true)][string]$Installer,[string]$Out='tests/evidence/inst-1/silent-directory-results.json')
$ErrorActionPreference='Stop'
$started=Get-Date
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer=(Resolve-Path -LiteralPath $Installer).Path
Add-Type -Path (Join-Path $PSScriptRoot 'helpers/installer-window.cs') -ReferencedAssemblies System.Drawing
$root=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('wi1-'+[Guid]::NewGuid().ToString('N').Substring(0,16))
$profile=Join-Path $root 'synthetic-data'
$installation=Join-Path $root '中文 空格\WeftMate'
$control=Join-Path $env:APPDATA 'WeftMate inst1qa'
if(Test-Path -LiteralPath $control){throw 'Existing test identity data must not be replaced'}
[IO.Directory]::CreateDirectory($profile)|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $root 'temp'))|Out-Null
[IO.File]::WriteAllText((Join-Path $profile '.weftmate-personal-host-profile.json'),'{"schemaVersion":1,"purpose":"isolated-personal-host"}')
[IO.File]::WriteAllText((Join-Path $profile 'keep-me.txt'),'INST-1 synthetic data must survive upgrades and uninstall')
[IO.File]::WriteAllText((Join-Path $root 'install-path.json'),(@{installation=$installation}|ConvertTo-Json))
$config=Join-Path $control 'WeftMate/desktop-config.json'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($config))|Out-Null
[IO.File]::WriteAllText($config,(@{schemaVersion=1;dataDirectory=$profile;accessPort=0}|ConvertTo-Json))
$env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
foreach($entry in (Get-ChildItem Env:|Where-Object {$_.Name -match '^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)'})){[Environment]::SetEnvironmentVariable($entry.Name,$null,'Process')}
$env:WEFTMATE_MEMOWEFT_ENABLED='0';$env:WEFTMATE_TEST_HOST_NAME='synthetic-host'
$desktop=[InstallerDesktop]::new('WeftMateInst1Silent-'+[Guid]::NewGuid().ToString('N'))
$passed=$false
$cleaned=0
try {
  # NSIS /D consumes the final remainder, including spaces; do not quote it.
  $pidInstall=$desktop.Launch($Installer,"/S /currentuser /D=$installation",$workspace)
  $process=Get-Process -Id $pidInstall -ErrorAction Stop
  if(!$process.WaitForExit(300000)-or$desktop.ExitCode($pidInstall)-ne0){throw 'Silent custom-directory install failed'}
  $registration=Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*|Where-Object {$_.DisplayName-eq'WeftMate inst1qa'}
  if(!$registration){throw 'Silent install registration missing'}
  $location=Get-ItemPropertyValue -LiteralPath ('HKCU:\Software\'+$registration.PSChildName) -Name InstallLocation
  if($location.TrimEnd('\')-ne$installation-or!(Test-Path -LiteralPath (Join-Path $installation 'WeftMate-inst1qa.exe'))){throw 'NSIS /D did not preserve the explicit target'}
  $shortcut=Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/WeftMate inst1qa.lnk'
  $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  if($link.TargetPath-ne(Join-Path $installation 'WeftMate-inst1qa.exe')){throw 'Silent custom-directory shortcut mismatch'}
  $uninstaller=(Get-ChildItem -LiteralPath $installation -Filter 'Uninstall*.exe'|Select-Object -First 1).FullName
  $pidUninstall=$desktop.Launch($uninstaller,'/S /currentuser',$workspace)
  $process=Get-Process -Id $pidUninstall -ErrorAction Stop
  if(!$process.WaitForExit(120000)-or$desktop.ExitCode($pidUninstall)-ne0){throw 'Silent custom-directory uninstall failed'}
  $end=[DateTime]::UtcNow.AddSeconds(120)
  while((Test-Path -LiteralPath $installation)-and[DateTime]::UtcNow-lt$end){Start-Sleep -Milliseconds 200}
  if((Test-Path -LiteralPath $installation)-or(Test-Path -LiteralPath $shortcut)-or(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*|Where-Object {$_.DisplayName-eq'WeftMate inst1qa'})){throw 'Silent uninstall left installation registration or files'}
  if(!(Test-Path -LiteralPath (Join-Path $profile 'keep-me.txt'))){throw 'Silent uninstall deleted data'}
  $passed=$true
  [IO.File]::WriteAllText((Join-Path $workspace $Out),(@{testIdentity='inst1qa';synthetic=$true;privateDesktop=$true;globalInputUsed=$false;standardDirectoryParameter=$true;directoryContainsUnicodeAndSpace=$true;registeredTarget=$true;startMenuTarget=$true;silentInstallExit=0;silentUninstallExit=0;uninstalled=$true;dataPreserved=$true}|ConvertTo-Json))
} finally {
  foreach($process in (Get-CimInstance Win32_Process|Where-Object {$_.CreationDate-ge$started-and$_.ExecutablePath-and$_.CommandLine-and($_.ExecutablePath-eq$Installer-or$_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase))-and($_.CommandLine.Contains($Installer)-or$_.CommandLine.Contains($root))})){ $handle=Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue;if($handle){try{if(!$handle.HasExited){Stop-Process -InputObject $handle -Force;$cleaned++};if(!$handle.WaitForExit(30000)){throw 'Synthetic silent process did not exit'}}finally{$handle.Dispose()}} }
  $desktop.Dispose()
  Write-Output "已清理进程：$cleaned"
  if($passed){$report=Get-Content -LiteralPath (Join-Path $workspace $Out) -Raw|ConvertFrom-Json;$report|Add-Member -NotePropertyName cleanedProcesses -NotePropertyValue $cleaned;[IO.File]::WriteAllText((Join-Path $workspace $Out),($report|ConvertTo-Json))}
  if($passed){& node (Join-Path $PSScriptRoot 'inst-1-cleanup.mjs') $root;if($LASTEXITCODE){throw 'Silent directory fixture cleanup failed'}}
}
