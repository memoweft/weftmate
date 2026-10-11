param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$UpgradeInstaller,[string]$Out='tests/evidence/inst-1')
$ErrorActionPreference='Stop'
$started=Get-Date
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer=(Resolve-Path -LiteralPath $Installer).Path
$UpgradeInstaller=(Resolve-Path -LiteralPath $UpgradeInstaller).Path
$Out=[IO.Path]::GetFullPath((Join-Path $workspace $Out))
[IO.Directory]::CreateDirectory($Out)|Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'helpers/installer-window.cs') -ReferencedAssemblies System.Drawing
# NSIS stages the old tree under TEMP/…/old-install. Keep this synthetic base
# short enough for its existing MAX_PATH behavior and deeply nested DSH files.
$root=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('wi1-'+[Guid]::NewGuid().ToString('N').Substring(0,16))
$installation=Join-Path $root 'installed'
$profile=Join-Path $root 'synthetic-data'
$control=Join-Path $env:APPDATA 'WeftMate inst1qa'
$shortcut=Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/WeftMate inst1qa.lnk'
$config=Join-Path $control 'WeftMate/desktop-config.json'
if(Test-Path -LiteralPath $control){throw 'Test identity already has control data; refusing to replace it'}
[IO.Directory]::CreateDirectory($profile)|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $root 'temp'))|Out-Null
$env:TEMP=Join-Path $root 'temp'
$env:TMP=$env:TEMP
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($config))|Out-Null
[IO.File]::WriteAllText((Join-Path $profile '.weftmate-personal-host-profile.json'),'{"schemaVersion":1,"purpose":"isolated-personal-host"}')
[IO.File]::WriteAllText((Join-Path $profile 'keep-me.txt'),'INST-1 synthetic data must survive upgrades and uninstall')
$configValue=@{schemaVersion=1;dataDirectory=$profile;accessPort=0;updates=@{channel='preview'};production=@{relayEnabled=$false;acmeEnabled=$false}}
[IO.File]::WriteAllText($config,($configValue|ConvertTo-Json -Depth 5))
foreach($entry in (Get-ChildItem Env: | Where-Object {$_.Name -match '^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY|ELECTRON_RUN_AS_NODE)'})){[Environment]::SetEnvironmentVariable($entry.Name,$null,'Process')}
$env:WEFTMATE_MEMOWEFT_ENABLED='0'
$env:WEFTMATE_TEST_HOST_NAME='synthetic-host'
$errorLog=Join-Path $root 'installer-errors.txt'
$env:WEFTMATE_INSTALLER_TEST_ERROR_LOG=$errorLog
$desktop=[InstallerDesktop]::new('WeftMateInst1QA-'+[Guid]::NewGuid().ToString('N'))
$cleaned=0;$rows=@();$pids=@()
function Await-Window([string]$kind,[string]$title='',[int]$timeout=60000){
  $end=[DateTime]::UtcNow.AddMilliseconds($timeout)
  do{if(Test-Path -LiteralPath $errorLog){throw "Native installer error: $([IO.File]::ReadAllText($errorLog))"};$h=$desktop.Find($kind,$title);if($h){return $h};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $end)
  $dialog=$desktop.Find('dialog','')
  if($dialog){$diagnostic=Join-Path $workspace '.local/inst-1-diagnostic.png';$desktop.Capture($dialog,$diagnostic);Write-Host ($desktop.DetailText($dialog)-join "`n")}
  throw "Window timeout: $kind / $title; private desktop: $($desktop.Windows() -join '; ')"
}
function Capture([long]$h,[string]$name){Start-Sleep -Milliseconds 350;$desktop.Capture($h,(Join-Path $Out $name))}
function Await-InstallerExit([int]$processId){
  $process=Get-Process -Id $processId -ErrorAction SilentlyContinue
  if($process -and !$process.WaitForExit(30000)){throw 'The preceding installer must finish before another installer starts'}
  $exit=$desktop.ExitCode($processId);Write-Output "Installer process $processId exit: $exit";if($exit -ne 0){throw "Installer exited with $exit"}
}
function Prepare-AppPort {
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT=[string]$listener.LocalEndpoint.Port;$listener.Stop()
}
function App-Theme([string]$theme){
  $connection=Get-NetTCPConnection -State Listen -LocalPort ([int]$env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT) -ErrorAction Stop|Select-Object -First 1
  $owner=Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
  if(!$owner.ExecutablePath.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase)-or!$owner.CommandLine.Contains($root)-or$owner.CreationDate -lt $started){throw 'Debug port must belong to this synthetic installed app'}
  & node (Join-Path $PSScriptRoot 'helpers/installer-app-theme.mjs') $env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT $theme
  if($LASTEXITCODE -ne 0){throw 'Real app theme setup failed'}
}
function Stop-TestApp {
  $found=Get-CimInstance Win32_Process | Where-Object {$_.CreationDate -ge $started -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and $_.CommandLine.Contains($installation)}
  foreach($process in $found){$handle=Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue;try{if($handle){if(!$handle.HasExited){Stop-Process -InputObject $handle -Force -ErrorAction SilentlyContinue;$script:cleaned++};if(!$handle.WaitForExit(30000)){throw 'Synthetic app process did not finish exiting'}}}finally{if($handle){$handle.Dispose()}}}
}
try {
  foreach($theme in 'light','dark') {
    $env:WEFTMATE_INSTALLER_TEST_THEME=$theme
    $env:WEFTMATE_INSTALLER_TEST_ABORT='1'
    $pidFailure=$desktop.Launch($Installer,"/currentuser /D=$installation",$workspace);$pids+=$pidFailure
    $failure=Await-Window prompt;Capture $failure "failure-$theme.png"
    $desktop.Button($failure,1)
    $process=Get-Process -Id $pidFailure -ErrorAction SilentlyContinue
    if($process -and !$process.WaitForExit(30000)){throw 'Failed installer left a progress window'}
    if($desktop.ExitCode($pidFailure) -ne 2){throw 'Failed installer must return failure'}
    $env:WEFTMATE_INSTALLER_TEST_ABORT=$null
    Prepare-AppPort
    $pidInstall=$desktop.Launch($Installer,"/currentuser /D=$installation",$workspace);$pids+=$pidInstall
    $h=Await-Window progress '正在安装';Capture $h "install-$theme.png"
    $app=Await-Window app '' 600000;App-Theme $theme;Capture $app "opened-$theme.png"
    Await-InstallerExit $pidInstall
    if(!(Test-Path -LiteralPath (Join-Path $installation 'WeftMate-inst1qa.exe'))){throw 'Installed executable missing'}
    $registration=Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object {$_.DisplayName -eq 'WeftMate inst1qa'}
    if(!$registration){throw 'Current-user uninstall registration missing'}
    if($registration.DisplayVersion -ne '0.1.1-preview.21'){throw 'Initial test version mismatch'}
    $installedIcon=Join-Path $installation 'uninstallerIcon.ico'
    if((Get-FileHash -LiteralPath $installedIcon).Hash -ne (Get-FileHash -LiteralPath (Join-Path $workspace 'build/icon.ico')).Hash){throw 'Installed uninstall icon must match the application brand'}
    if($registration.DisplayIcon -ne $installedIcon -or !(Test-Path -LiteralPath $shortcut)){throw 'Uninstall icon or named Start Menu shortcut missing'}
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut($shortcut)
    if($link.TargetPath -ne (Join-Path $installation 'WeftMate-inst1qa.exe')){throw 'Start Menu shortcut target is not this test installation'}
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)|Out-Null
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)|Out-Null
    Prepare-AppPort
    $pidUpdate=$desktop.Launch($UpgradeInstaller,"/currentuser /D=$installation",$workspace);$pids+=$pidUpdate
    $busy=Await-Window prompt;Capture $busy "running-retry-$theme.png"
    $uiModules=(Get-Process -Id $pidUpdate).Modules | Where-Object {$_.FileName.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase)}
    if($uiModules){throw "Installer UI loaded an old application DLL: $($uiModules.ModuleName -join ', ')"}
    if(!($desktop.Find('app',''))){throw 'Installer unexpectedly closed the running app'}
    Stop-TestApp
    $desktop.Button($busy,4)
    $up=Await-Window progress '正在更新';Capture $up "update-$theme.png"
    $app=Await-Window app '' 600000;App-Theme $theme;Capture $app "reopened-$theme.png"
    Await-InstallerExit $pidUpdate
    $registration=Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*|Where-Object {$_.DisplayName -eq 'WeftMate inst1qa'}
    if($registration.DisplayVersion -ne '0.1.2-preview.22'){throw 'Manual upgrade version mismatch'}
    if([IO.File]::ReadAllText((Join-Path $profile 'keep-me.txt')) -ne 'INST-1 synthetic data must survive upgrades and uninstall'){throw 'Upgrade changed data'}
    Stop-TestApp
    $uninstaller=Get-ChildItem -LiteralPath $installation -Filter 'Uninstall*.exe' | Select-Object -First 1
    $pidUninstall=$desktop.Launch($uninstaller.FullName,'/currentuser',$workspace);$pids+=$pidUninstall
    $confirm=Await-Window prompt;Capture $confirm "uninstall-confirm-$theme.png"
    $pidUninstallWorker=$desktop.WindowProcess($confirm)
    $desktop.Button($confirm,1)
    $un=Await-Window progress '正在卸载';Capture $un "uninstall-$theme.png"
    $end=[DateTime]::UtcNow.AddSeconds(90);while((Test-Path -LiteralPath $installation)-and[DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 200}
    if(Test-Path -LiteralPath $installation){throw 'Test installation was not removed'}
    $end=[DateTime]::UtcNow.AddSeconds(30)
    while($desktop.Find('progress','正在卸载') -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 100}
    if($desktop.Find('progress','正在卸载')){throw 'Uninstaller did not finish its final section'}
    Await-InstallerExit $pidUninstallWorker
    if(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object {$_.DisplayName -eq 'WeftMate inst1qa'}){throw 'Uninstall registration remains'}
    if(Test-Path -LiteralPath $shortcut){throw 'Test Start Menu shortcut remains'}
    if(!(Test-Path -LiteralPath (Join-Path $profile 'keep-me.txt'))){throw 'Uninstall deleted data'}
    $rows+=@{theme=$theme;installed=$true;fromVersion='0.1.1-preview.21';toVersion='0.1.2-preview.22';automaticallyOpened=$true;runningRetry=$true;updated=$true;automaticallyReopened=$true;uninstalled=$true;dataPreserved=$true;syntheticFailureExit=2;installedIconMatches=$true;startMenuTargetVerified=$true;startMenuRemoved=$true}
  }
} finally {
  Stop-TestApp
  # Only processes created by this runner, with this package's exact paths.
  foreach($process in (Get-CimInstance Win32_Process | Where-Object {$_.CreationDate -ge $started -and $_.ExecutablePath -and $_.CommandLine -and ($_.ExecutablePath -eq $Installer -or $_.ExecutablePath -eq $UpgradeInstaller -or $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -and ($_.CommandLine.Contains($root) -or $_.CommandLine.Contains($Installer) -or $_.CommandLine.Contains($UpgradeInstaller))})){Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue;$cleaned++}
  $measurements=@($desktop.CaptureMeasurements()|ForEach-Object {$_|ConvertFrom-Json})
  $desktop.Dispose()
  $report=@{synthetic=$true;testIdentity='inst1qa';privateDesktop=$true;globalInputUsed=$false;checks=$rows;cleanedProcesses=$cleaned;captureGeometry=$measurements}
  [IO.File]::WriteAllText((Join-Path $Out 'interactive-results.json'),($report|ConvertTo-Json -Depth 6))
  # Keep data for diagnosis on failure; successful fixtures are removed.
  if($rows.Count -eq 2){& node (Join-Path $PSScriptRoot 'inst-1-cleanup.mjs') $root;if($LASTEXITCODE -ne 0){throw 'Synthetic fixture cleanup failed'}}
}
