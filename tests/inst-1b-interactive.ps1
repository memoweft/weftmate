param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$UpgradeInstaller,[string]$Out=(Join-Path $(if ($env:WEFTMATE_EVIDENCE_DIR) { $env:WEFTMATE_EVIDENCE_DIR } else { '.local/evidence' }) 'inst-1'),[ValidateSet('both','default','custom')][string]$Mode='both',[switch]$Watchdog)
$ErrorActionPreference='Stop'
$started=Get-Date
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Installer=(Resolve-Path -LiteralPath $Installer).Path
$UpgradeInstaller=(Resolve-Path -LiteralPath $UpgradeInstaller).Path
$Out=[IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $workspace $Out }))
[IO.Directory]::CreateDirectory($Out)|Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'helpers/installer-window.cs') -ReferencedAssemblies System.Drawing
# NSIS stages the old tree under TEMP/…/old-install. Keep this synthetic base
# short enough for its existing MAX_PATH behavior and deeply nested DSH files.
$root=Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('wi1-'+[Guid]::NewGuid().ToString('N').Substring(0,16))
$defaultInstallation=Join-Path $env:LOCALAPPDATA 'Programs/WeftMate-inst1qa'
$installation=$defaultInstallation
$pickerFile=Join-Path $root 'folder.txt'
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
$env:WEFTMATE_INSTALLER_TEST_DPI='144'
$env:WEFTMATE_INSTALLER_TEST_PICK_FOLDER='@'+$pickerFile
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
  if(!$owner.ExecutablePath.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase)-or$owner.CreationDate -lt $started){throw 'Debug port must belong to this synthetic installed app'}
  & node (Join-Path $PSScriptRoot 'helpers/installer-app-theme.mjs') $env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT $theme on
  if($LASTEXITCODE -ne 0){throw 'Real app theme setup failed'}
}
function Stop-TestApp {
  $found=Get-CimInstance Win32_Process | Where-Object {$_.CreationDate -ge $started -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and $_.CommandLine.Contains($installation)}
  foreach($process in $found){$handle=Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue;try{if($handle){if(!$handle.HasExited){Stop-Process -InputObject $handle -Force -ErrorAction SilentlyContinue;$script:cleaned++};if(!$handle.WaitForExit(30000)){throw 'Synthetic app process did not finish exiting'}}}finally{if($handle){$handle.Dispose()}}}
}
try {
  foreach($mode in $(if($Mode -eq 'both'){@('default','custom')}else{@($Mode)})){
  foreach($theme in 'light','dark') {
    $installation=$defaultInstallation
    [IO.File]::WriteAllText((Join-Path $root 'install-path.json'),(@{installation=$installation}|ConvertTo-Json))
    $env:WEFTMATE_INSTALLER_TEST_THEME=$theme
    Prepare-AppPort
    $pidInstall=$desktop.Launch($Installer,'/currentuser',$workspace);$pids+=$pidInstall
    $ready=Await-Window progress '准备安装 WeftMate'
    if(!$desktop.Frameless($ready)-or$desktop.HeaderHit($ready)-ne 2){throw 'Own frame or draggable header missing'}
    Capture $ready "$mode-ready-$theme.png"
    if($mode -eq 'custom'){
      $denied=Join-Path $root 'denied';[IO.Directory]::CreateDirectory($denied)|Out-Null
      $acl=Get-Acl -LiteralPath $denied;$originalAcl=$acl
      $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'CreateFiles,CreateDirectories','Deny')
      $acl.AddAccessRule($rule);Set-Acl -LiteralPath $denied -AclObject $acl
      try{
        [IO.File]::WriteAllText($pickerFile,$denied,[Text.Encoding]::Unicode);$desktop.Button($ready,81);Start-Sleep -Milliseconds 500
        if(!(($desktop.DetailText($ready)-join ' ') -match '无法写入')){throw 'Unwritable path must show a human explanation'}
        Capture $ready "unwritable-$theme.png"
      }finally{$acl.RemoveAccessRule($rule)|Out-Null;Set-Acl -LiteralPath $denied -AclObject $acl}
      $parent=Join-Path $root '中文 空格';[IO.Directory]::CreateDirectory($parent)|Out-Null
      [IO.File]::WriteAllText($pickerFile,$parent,[Text.Encoding]::Unicode);$desktop.Button($ready,81);Start-Sleep -Milliseconds 500
      $installation=Join-Path $parent 'WeftMate'
      [IO.File]::WriteAllText((Join-Path $root 'install-path.json'),(@{installation=$installation}|ConvertTo-Json))
      if(!(($desktop.DetailText($ready)-join ' ').Contains($installation))){throw 'Selected parent must get a WeftMate subfolder'}
      Capture $ready "custom-location-$theme.png"
    }
    $tabs=@($desktop.FocusId($ready));foreach($n in 1..3){$desktop.Key($ready,9);Start-Sleep -Milliseconds 150;$tabs+=$desktop.FocusId($ready)}
    if(($tabs -join ',') -ne '80,90,81,80'){throw "Unexpected ready Tab order: $($tabs -join ',')"}
    $desktop.Key($ready,13)
    $h=Await-Window progress '正在安装';if(!$desktop.Frameless($h)-or$desktop.Enabled($h,90)){throw 'Progress close must be disabled'};$desktop.Close($h);Capture $h "$mode-install-$theme.png"
    $app=Await-Window app '' 600000;App-Theme $theme;Capture $app "$mode-opened-$theme.png"
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
    $startup=(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -ErrorAction SilentlyContinue).'WeftMate inst1qa'
    if(!$startup -or !$startup.Contains((Join-Path $installation 'WeftMate-inst1qa.exe'))){throw 'Auto-start must target the current installation'}
    $startupLaunched=$false
    if($mode -eq 'custom'){
      Stop-TestApp
      if($startup -notmatch '^"([^"]+)"\s+(.*)$'){throw 'Startup command must quote the custom executable'}
      $startupPid=$desktop.Launch($Matches[1],$Matches[2],$workspace)
      $end=[DateTime]::UtcNow.AddSeconds(90);$startupLogged=$false
      do{
        Start-Sleep -Milliseconds 250
        $logFiles=Get-ChildItem -LiteralPath (Join-Path $profile 'logs') -Filter 'host-*.jsonl' -ErrorAction SilentlyContinue
        foreach($logFile in $logFiles){foreach($line in (Get-Content -LiteralPath $logFile.FullName)){try{$entry=$line|ConvertFrom-Json;if($entry.event-eq'host.start' -and $entry.pid-eq$startupPid){$startupLogged=$true}}catch{}}}
      }while(!$startupLogged -and [DateTime]::UtcNow -lt $end)
      if(!$startupLogged){throw 'Actual startup registry command did not start the synthetic host'}
      $startupLaunched=$true;Stop-TestApp;Prepare-AppPort
      $desktop.Launch((Join-Path $installation 'WeftMate-inst1qa.exe'),"--disable-gpu --remote-debugging-port=$env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT `"--desktop-config=$config`"",$workspace)|Out-Null
      $app=Await-Window app '' 600000;App-Theme $theme
    }
    $monitorHealthy=$false;$monitorCloseRetry=$false
    if($Watchdog -and $mode -eq 'custom' -and $theme -eq 'light'){
      Stop-TestApp
      $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$mainPort=$listener.LocalEndpoint.Port;$listener.Stop()
      $ownExe=Join-Path $installation 'WeftMate-inst1qa.exe'
      $mainPid=$desktop.Launch($ownExe,"--disable-gpu --inspect=127.0.0.1:$mainPort `"--desktop-config=$config`"",$workspace)
      $end=[DateTime]::UtcNow.AddSeconds(90)
      do{$debug=Get-NetTCPConnection -State Listen -LocalPort $mainPort -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 200}while(!$debug -and [DateTime]::UtcNow -lt $end)
      if(!$debug -or $debug.OwningProcess -ne $mainPid){throw 'Synthetic main debugger ownership failed'}
      Await-Window app '' 600000|Out-Null
      $ErrorActionPreference='Continue'
      & node (Join-Path $PSScriptRoot 'helpers/installer-main-update.mjs') $mainPort $UpgradeInstaller $config 2>&1
      $status=$LASTEXITCODE;$ErrorActionPreference='Stop'
      if($status){throw 'Preparing real update monitor failed'}
      $resultFile=Join-Path $control 'WeftMate/app-recovery/last-result.json';$end=[DateTime]::UtcNow.AddMinutes(10)
      do{Start-Sleep -Milliseconds 500;$health=if(Test-Path -LiteralPath $resultFile){Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json}else{$null}}while(!$health -and [DateTime]::UtcNow -lt $end)
      if($health.phase -eq 'recovery-failed' -and $health.step -eq 'check-closed-program' -and $health.code -eq 'SYSTEM_QUERY_FAILED'){
        # Preserve the production guard and its failure. Retry the unchanged
        # snapshot helper only after the test's entire old exe family is gone.
        $end=[DateTime]::UtcNow.AddSeconds(60)
        do{$left=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath-eq$ownExe});if($left.Count){Start-Sleep -Milliseconds 250}}while($left.Count -and [DateTime]::UtcNow-lt$end)
        if($left.Count){throw 'Old synthetic program is still present'}
        $recoveryRoot=Join-Path $control 'WeftMate/app-recovery'
        $pending=Get-Content -LiteralPath (Join-Path $recoveryRoot 'pending.json') -Raw|ConvertFrom-Json
        if($pending.executable-ne$ownExe -or $pending.configFile-ne$config -or !$pending.snapshot.StartsWith($recoveryRoot+'\') -or (Get-CimInstance Win32_Process -Filter "ProcessId=$($pending.oldPid)" -ErrorAction SilentlyContinue)){throw 'Snapshot retry ownership/closed PID check failed'}
        $previousNode=$env:ELECTRON_RUN_AS_NODE
        try{$env:ELECTRON_RUN_AS_NODE='1';$retryPid=$desktop.Launch((Join-Path $pending.snapshot 'program/WeftMateRecovery.exe'),('"'+(Join-Path $pending.snapshot 'monitor.mjs')+'" "'+$recoveryRoot+'"'),$pending.snapshot)}finally{$env:ELECTRON_RUN_AS_NODE=$previousNode}
        $process=Get-Process -Id $retryPid -ErrorAction SilentlyContinue
        if($process -and !$process.WaitForExit(600000)){throw 'Unchanged monitor retry did not finish'}
        if($desktop.ExitCode($retryPid)-ne0){throw 'Unchanged monitor retry failed'}
        $health=Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json;$monitorCloseRetry=$true
      }
      if($health.phase -ne 'healthy' -or $health.version -ne '0.1.2-preview.22'){throw 'Real custom-path watchdog did not reach healthy'}
      if((Get-Content -LiteralPath $config -Raw|ConvertFrom-Json).dataDirectory -ne $profile){throw 'Monitor changed the data directory'}
      $hiddenApp=Await-Window app-hidden '' 600000
      if($hiddenApp -and !$desktop.Find('app','')){
        $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($desktop.WindowProcess($hiddenApp))"
        if($owner.ExecutablePath-ne$ownExe -or $owner.CreationDate-lt$started -or !$owner.CommandLine.Contains($installation)){throw 'Private monitor window ownership failed'}
        $desktop.Show($hiddenApp)
      }
      Await-Window app '' 600000|Out-Null;$monitorHealthy=$true
    }
    Prepare-AppPort
    $pidUpdate=$desktop.Launch($UpgradeInstaller,"/currentuser",$workspace);$pids+=$pidUpdate
    $busy=Await-Window prompt;Capture $busy "$mode-running-retry-$theme.png"
    $uiModules=(Get-Process -Id $pidUpdate).Modules | Where-Object {$_.FileName.StartsWith($installation+'\',[StringComparison]::OrdinalIgnoreCase)}
    if($uiModules){throw "Installer UI loaded an old application DLL: $($uiModules.ModuleName -join ', ')"}
    if(!($desktop.Find('app',''))){throw 'Installer unexpectedly closed the running app'}
    Stop-TestApp
    $desktop.Button($busy,4)
    $up=Await-Window progress '正在更新';Capture $up "$mode-update-$theme.png"
    $app=Await-Window app '' 600000;App-Theme $theme;Capture $app "$mode-reopened-$theme.png"
    Await-InstallerExit $pidUpdate
    $registration=Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*|Where-Object {$_.DisplayName -eq 'WeftMate inst1qa'}
    $registeredLocation=(Get-ItemProperty ('HKCU:/Software/'+$registration.PSChildName)).InstallLocation
    if($registeredLocation.TrimEnd('\') -ne $installation){throw 'Upgrade moved the existing installation'}
    if($registration.DisplayVersion -ne '0.1.2-preview.22'){throw 'Manual upgrade version mismatch'}
    if([IO.File]::ReadAllText((Join-Path $profile 'keep-me.txt')) -ne 'INST-1 synthetic data must survive upgrades and uninstall'){throw 'Upgrade changed data'}
    $migrationChecked=$false
    if($Watchdog -and $mode -eq 'custom' -and $theme -eq 'light'){
      Stop-TestApp
      $worker=Join-Path $PSScriptRoot 'helpers/installer-migration.ps1'
      $ownExe=Join-Path $installation 'WeftMate-inst1qa.exe'
      $pidMigration=$desktop.Launch((Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'),"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$worker`" -Root `"$root`" -Installer `"$UpgradeInstaller`" -InstalledExe `"$ownExe`" -ConfigFile `"$config`"",$workspace)
      $process=Get-Process -Id $pidMigration -ErrorAction SilentlyContinue
      if($process -and !$process.WaitForExit(600000)){throw 'Synthetic migration did not finish'}
      if($desktop.ExitCode($pidMigration)-ne0){throw 'Synthetic custom-path migration failed'}
      $migrationResult=Get-Content -LiteralPath (Join-Path $root 'migration-result.json') -Raw|ConvertFrom-Json
      if(!$migrationResult.verify -or !$migrationResult.rollback){throw 'Migration did not verify and roll back'}
      $migrationChecked=$true
      Prepare-AppPort
      $desktop.Launch($ownExe,"--disable-gpu --remote-debugging-port=$env:WEFTMATE_INSTALLER_TEST_DEBUG_PORT `"--desktop-config=$config`"",$workspace)|Out-Null
      $app=Await-Window app '' 600000;App-Theme $theme
    }
    Stop-TestApp
    $uninstaller=Get-ChildItem -LiteralPath $installation -Filter 'Uninstall*.exe' | Select-Object -First 1
    $pidUninstall=$desktop.Launch($uninstaller.FullName,'/currentuser',$workspace);$pids+=$pidUninstall
    $confirm=Await-Window prompt;Capture $confirm "$mode-uninstall-confirm-$theme.png"
    $pidUninstallWorker=$desktop.WindowProcess($confirm)
    $desktop.Button($confirm,1)
    $un=Await-Window progress '正在卸载';Capture $un "$mode-uninstall-$theme.png"
    $end=[DateTime]::UtcNow.AddSeconds(90);while((Test-Path -LiteralPath $installation)-and[DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 200}
    if(Test-Path -LiteralPath $installation){throw 'Test installation was not removed'}
    $end=[DateTime]::UtcNow.AddSeconds(30)
    while($desktop.Find('progress','正在卸载') -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 100}
    if($desktop.Find('progress','正在卸载')){throw 'Uninstaller did not finish its final section'}
    Await-InstallerExit $pidUninstallWorker
    if(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object {$_.DisplayName -eq 'WeftMate inst1qa'}){throw 'Uninstall registration remains'}
    if(Test-Path -LiteralPath $shortcut){throw 'Test Start Menu shortcut remains'}
    if(!(Test-Path -LiteralPath (Join-Path $profile 'keep-me.txt'))){throw 'Uninstall deleted data'}
    if((Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -ErrorAction SilentlyContinue).'WeftMate inst1qa'){throw 'Uninstall left auto-start'}
    $rows+=@{mode=$mode;monitorHealthy=$monitorHealthy;monitorCloseQueryRetry=$monitorCloseRetry;manualFromVersion=$(if($monitorHealthy){'0.1.2-preview.22'}else{'0.1.1-preview.21'});migrationCustomPath=$migrationChecked;tabOrder=$tabs;frameless=$true;draggableHeader=$true;closeDisabledDuringProgress=$true;autoStartCustomTarget=$true;actualStartupCommandLaunched=$startupLaunched;autoStartRemoved=$true;upgradeWithoutDirectoryArgument=$true;theme=$theme;installed=$true;fromVersion='0.1.1-preview.21';toVersion='0.1.2-preview.22';automaticallyOpened=$true;runningRetry=$true;updated=$true;automaticallyReopened=$true;uninstalled=$true;dataPreserved=$true;installedIconMatches=$true;startMenuTargetVerified=$true;startMenuRemoved=$true}
  }
  }
} finally {
  Stop-TestApp
  # Only processes created by this runner, with this package's exact paths.
  foreach($process in (Get-CimInstance Win32_Process | Where-Object {$_.CreationDate -ge $started -and $_.ExecutablePath -and $_.CommandLine -and ($_.ExecutablePath -eq $Installer -or $_.ExecutablePath -eq $UpgradeInstaller -or $_.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) -and ($_.CommandLine.Contains($root) -or $_.CommandLine.Contains($Installer) -or $_.CommandLine.Contains($UpgradeInstaller))})){Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue;$cleaned++}
  $measurements=@($desktop.CaptureMeasurements()|ForEach-Object {$_|ConvertFrom-Json})
  $desktop.Dispose()
  $report=@{synthetic=$true;testIdentity='inst1qa';privateDesktop=$true;globalInputUsed=$false;checks=$rows;cleanedProcesses=$cleaned;captureGeometry=$measurements}
  [IO.File]::WriteAllText((Join-Path $Out ('interactive-position-'+$Mode+'-results.json')),($report|ConvertTo-Json -Depth 6))
  # Keep data for diagnosis on failure; successful fixtures are removed.
  if($rows.Count -eq $(if($Mode -eq 'both'){4}else{2})){& node (Join-Path $PSScriptRoot 'inst-1-cleanup.mjs') $root;if($LASTEXITCODE -ne 0){throw 'Synthetic fixture cleanup failed'}}
}
