param([Parameter(Mandatory=$true)][string]$Installer1,[Parameter(Mandatory=$true)][string]$Installer2,[string]$Evidence='tests/evidence/inst-2')
$ErrorActionPreference='Stop'
$started=Get-Date
$identity='WeftMate inst2qa'
$exeName='WeftMate-inst2qa.exe'
$root=Join-Path 'C:\weftmate-temp' ('inst2-'+[Guid]::NewGuid().ToString('N').Substring(0,10))
New-Item -ItemType Directory -Path $root,$Evidence -Force | Out-Null
$Evidence=[IO.Path]::GetFullPath($Evidence)
$configRoot=Join-Path $env:APPDATA $identity
$config=Join-Path $configRoot 'WeftMate\desktop-config.json'
$profile=Join-Path $root 'data'
New-Item -ItemType Directory -Path $profile,(Split-Path $config) -Force | Out-Null
@{schemaVersion=1;purpose='isolated-personal-host'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $profile '.weftmate-personal-host-profile.json')
@{schemaVersion=1;dataDirectory=$profile;accessPort=0;production=@{relayEnabled=$false;acmeEnabled=$false};updates=@{channel='preview';baseUrl=''}} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config
$env:WEFTMATE_TEST_HOST_NAME='synthetic-host'
$env:WEFTMATE_INSTALLER_TEST_PICK_FOLDER=Join-Path $root 'custom 中文 space'
$env:WEFTMATE_INSTALLER_TEST_THEME='light'
$report=[ordered]@{identity='inst2qa';realModelRequests=0;scenarios=@();allUsers=@{adminToken=$false;installed=$false};cleanup=@{}}
$references=@((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName)+@(Get-ChildItem -LiteralPath $PSHOME -Filter 'System.Private.Windows.*.dll' | ForEach-Object FullName)+(Join-Path $PSHOME 'System.Drawing.Common.dll')
Add-Type -Path (Join-Path $PSScriptRoot '../helpers/installer-window.cs') -ReferencedAssemblies $references
$desktop=[InstallerDesktop]::new('inst2-'+[Guid]::NewGuid().ToString('N'))
$script:registered=$null
function Assert($ok,$message) {if(!$ok){throw $message}}
function Until([scriptblock]$check,[int]$seconds=90) { $until=(Get-Date).AddSeconds($seconds); do {$value=& $check;if($value){return $value};Start-Sleep -Milliseconds 100}while((Get-Date)-lt $until);throw 'Condition timed out' }
function State {
 $rows=@();foreach($scope in 'HKCU','HKLM') {Get-ChildItem ($scope+':\Software\Microsoft\Windows\CurrentVersion\Uninstall') -ErrorAction SilentlyContinue | ForEach-Object { $v=Get-ItemProperty -LiteralPath $_.PSPath;if($v.DisplayName -eq $identity){$location=(Get-ItemProperty ($scope+':\Software\'+$_.PSChildName) -ErrorAction SilentlyContinue).InstallLocation;if(!$location -and $v.UninstallString -match '^"([^"]+)"'){$location=Split-Path $matches[1]};$rows+=@{scope=$scope;key=$_.PSChildName;version=$v.DisplayVersion;location=$location;uninstall=$v.UninstallString};$script:registered=$location} }}
 $login=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $identity -ErrorAction SilentlyContinue).$identity
 $send=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\*\shell\com.memoweft.weftmate.inst2qa.SendTo\command' -ErrorAction SilentlyContinue).'(default)'
 $links=@();$wsh=New-Object -ComObject WScript.Shell
 foreach($base in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('Desktop'))) {Get-ChildItem -LiteralPath $base -Filter '*inst2qa*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {$links+=@{file=$_.Name;target=$wsh.CreateShortcut($_.FullName).TargetPath}}}
 $processes=@(Get-Process -Name WeftMate-inst2qa -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $script:registered -and $_.Path.StartsWith($script:registered+'\',[StringComparison]::OrdinalIgnoreCase)} | ForEach-Object {@{pid=$_.Id;path=$_.Path}})
 return @{registry=$rows;login=$login;sendTo=$send;shortcuts=$links;processes=$processes;metadata=if($script:registered -and (Test-Path (Join-Path $script:registered 'resources\weftmate-install.json'))){Get-Content -LiteralPath (Join-Path $script:registered 'resources\weftmate-install.json') -Raw|ConvertFrom-Json}else{$null}}
}
function Silent($installer,$arguments,$label,$expected=0) {
 $before=State;$desktop.StartWindowProbe()
 try { $pid2=$desktop.Launch($installer,$arguments,$root);Until {if($desktop.ExitCode($pid2)-ne 259){$true}} 180|Out-Null;$code=$desktop.ExitCode($pid2) } finally {$probe=$desktop.StopWindowProbe()|ConvertFrom-Json}
 $after=State;$report.scenarios+=@{name=$label;arguments=$arguments;before=$before;after=$after;exitCode=$code;probe=$probe};Write-Host "$label exit=$code visible=$($probe.visibleWindows)"
 Assert ($code-eq $expected) "$label exit $code (expected $expected)"
 Assert ($probe.visibleWindows-eq 0) "$label visible windows"
 return $after
}
function Quit($location) { $pid2=$desktop.Launch((Join-Path $location $exeName),'--quit',$root);Until {if($desktop.ExitCode($pid2)-ne 259){$true}} 25|Out-Null;Assert ($desktop.ExitCode($pid2)-eq 0) 'normal quit failed';Until {if(!(Get-Process -Name WeftMate-inst2qa -ErrorAction SilentlyContinue|Where-Object {$_.Path-eq (Join-Path $location $exeName)})){$true}} 10|Out-Null }
function Open($location,$extra='') { $script:appPid=$desktop.Launch((Join-Path $location $exeName),'--disable-gpu '+$extra,$root);$stateFile=Join-Path $profile 'dsh-home\weftmate-host-state.json';Until {if(Test-Path $stateFile){try{$s=Get-Content $stateFile -Raw|ConvertFrom-Json;if($s.runtime.state-eq 'listening'){$s}}catch{}}} 120|Out-Null;return (Until {$desktop.Find('app-hidden','')} 60) }
function Uninstall { $s=State;if($s.registry.Count){$location=$s.registry[0].location;Quit $location;$uninstaller=Get-ChildItem -LiteralPath $location -Filter 'Uninstall*.exe'|Select-Object -First 1;Silent $uninstaller.FullName '/S /currentuser' 'uninstall'|Out-Null;Assert (!(Test-Path (Join-Path $location $exeName))) 'installed files remain'} }
function SafeRemove($directory) {
 $full=[IO.Path]::GetFullPath($directory);Assert ($full-eq $root -or $full-eq $configRoot) 'cleanup target ownership'
 if(Test-Path $full){Get-ChildItem -LiteralPath $full -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {if($_.PSIsContainer){[IO.Directory]::Delete($_.FullName)}else{[IO.File]::Delete($_.FullName)}};Remove-Item -LiteralPath $full -Recurse -Force}
}
try {
 if((State).registry.Count){Uninstall}
 Assert ((State).registry.Count-eq 0) 'preexisting inst2qa installation'
 # Native /S default path, then preserve it without an explicit /D.
 $fresh=Silent $Installer2 '/S' 'silent-fresh-default';$default=$fresh.registry[0].location
 Assert ($default-match '\\WeftMate[- ]inst2qa$') 'test identity default path isolation'
 Assert ($fresh.processes.Count-eq 0) 'silent setup launched app'
 $covered=Silent $Installer2 '/S' 'silent-user-upgrade';Assert ($covered.registry[0].location-eq $default) 'registered path changed'
 Uninstall
 # Current-user custom path, upgrade while running: installer must please quit.
 $custom=Join-Path $root 'custom 中文 space\WeftMate'
 $s=Silent $Installer1 ('/S /currentuser /D='+$custom) 'silent-custom-fresh'
 $open=Open $custom;Quit $custom
 $report.scenarios+=@{name='external-quit';after=State;normalExit=$true}
 $open=Open $custom
 $s=Silent $Installer2 '/S' 'silent-running-custom-upgrade'
 Assert ($s.registry[0].location-eq $custom) 'custom path not inherited'
 $open=Open $custom
 $desktop.Show($open);$desktop.Capture($open,(Join-Path $Evidence 'after-normal-upgrade.png'))
 $logFiles=Get-ChildItem (Join-Path $profile 'logs') -Filter '*.jsonl' -Recurse
 $exitRecords=@($logFiles|ForEach-Object {Get-Content -LiteralPath $_.FullName|ForEach-Object {try{$row=$_|ConvertFrom-Json;if($row.event-eq 'host.exit' -or $row.type-eq 'host.exit'){$row}}catch{}}})
 $report.exitRecords=$exitRecords
 Quit $custom
 # Start repairs the historical missing executable without enabling new startup.
 $stale='"C:\synthetic-gone\WeftMate-inst2qa.exe" --start-in-tray "--desktop-config='+$config+'"'
 New-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $identity -Value $stale -PropertyType String -Force|Out-Null
 $before=State;$open=Open $custom;$after=State
 Assert ($after.login.StartsWith('"'+(Join-Path $custom $exeName)+'"')) 'startup path was not repaired'
 Assert ($after.login.EndsWith('"--desktop-config='+$config+'"')) 'startup configuration args changed'
 $report.scenarios+=@{name='startup-self-repair';before=$before;after=$after}
 Quit $custom
 # Interactive reinstall moves paths and opens automatically. System folder picker is a synthetic return value.
 $newParent=Join-Path $root 'relocated 中文 path';New-Item -ItemType Directory -Path $newParent -Force|Out-Null
 $env:WEFTMATE_INSTALLER_TEST_PICK_FOLDER=$newParent
 $before=State;$pid2=$desktop.Launch($Installer2,'',$root)
 $window=Until {$desktop.Find('progress','准备安装 WeftMate')}
 $desktop.Button($window,81);Start-Sleep -Milliseconds 200;$desktop.HoverPath($window);$desktop.Capture($window,(Join-Path $Evidence 'location-hover-light.png'))
 $desktop.Button($window,80);Until {if($desktop.ExitCode($pid2)-ne 259){$true}} 180|Out-Null;Assert ($desktop.ExitCode($pid2)-eq 0) 'interactive reinstall failed'
 $after=State;$moved=$after.registry[0].location
 Assert ($moved-ne $custom) 'interactive location did not move';Assert (!(Test-Path (Join-Path $custom $exeName))) 'old location survived'
 Assert ($after.login.StartsWith('"'+(Join-Path $moved $exeName)+'"')) 'login did not move'
 Assert ($after.sendTo.Contains($moved)) 'send-to did not move'
 Assert (@($after.shortcuts|Where-Object {$_.target-ne (Join-Path $moved $exeName)}).Count-eq 0) 'shortcut did not move'
 $open=Until {$desktop.Find('app-hidden','')} 120;$report.scenarios+=@{name='interactive-move-and-launch';before=$before;after=$after;automaticLaunch=$true;oldProgramRemoved=$true}
 Quit $moved
 $env:WEFTMATE_INSTALLER_TEST_THEME='dark';$pid2=$desktop.Launch($Installer2,'',$root);$window=Until {$desktop.Find('progress','准备安装 WeftMate')};$desktop.HoverPath($window);$desktop.Capture($window,(Join-Path $Evidence 'location-hover-dark.png'));$desktop.Close($window);Until {if($desktop.ExitCode($pid2)-ne 259){$true}} 15|Out-Null
 # The current session has no admin token. The all-user attempt must fail without UI or UAC.
 $report.allUsers.denied=Silent $Installer2 '/S /allusers' 'silent-all-users-no-admin' 740
 $s=Silent $Installer2 '--silent' 'long-option-silent';Assert ($s.registry[0].location-eq $moved) 'long option lost location'
 Uninstall
 $report.cleanup.registryCount=(State).registry.Count;$report.cleanup.startupRemoved=!(State).login;$report.cleanup.sendToRemoved=!(State).sendTo
 Assert ($report.cleanup.registryCount-eq 0 -and $report.cleanup.startupRemoved -and $report.cleanup.sendToRemoved) 'registration cleanup incomplete'
 $report.success=$true
} catch { $report.success=$false;$report.failure=$_.Exception.Message;throw } finally {
 try{Uninstall}catch{$report.cleanup.failure=$_.Exception.Message}
 $desktop.Dispose()
 $report.finishedAt=(Get-Date).ToString('o')
 $json=$report|ConvertTo-Json -Depth 20;$json=$json -replace 'C:\\\\Users\\\\[^\\]+','C:\\Users\\<user>'
 $json|Set-Content -LiteralPath (Join-Path $Evidence 'installed-upgrade.json')
 SafeRemove $root;SafeRemove $configRoot
}
