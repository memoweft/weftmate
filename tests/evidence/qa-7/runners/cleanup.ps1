$ErrorActionPreference='Stop'
$qa7Start=[datetime]'2026-10-10T23:53:00'
$qa7Scope='weftmate-qa7-|tests[\\/]evidence[\\/]qa-7|Worktrees[\\/]w5'
$qa7Processes=Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $qa7Start -and $_.ExecutablePath -match '(node|electron|python|WeftMate(?:-Setup-[^\\]+)?)\.exe$' -and $_.CommandLine -match $qa7Scope }
$qa7Stopped=@()
foreach($qa7Process in $qa7Processes){Stop-Process -Id $qa7Process.ProcessId -ErrorAction Stop; $qa7Stopped+=@{processId=$qa7Process.ProcessId;created=$qa7Process.CreationDate;executable=$qa7Process.ExecutablePath}}
$qa7Temp=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
$qa7Removed=@()
foreach($qa7Directory in Get-ChildItem -LiteralPath $qa7Temp -Directory -Filter 'weftmate-qa7-*'){
 $qa7Path=[IO.Path]::GetFullPath($qa7Directory.FullName)
 if(!$qa7Path.StartsWith($qa7Temp,[StringComparison]::OrdinalIgnoreCase) -or $qa7Directory.CreationTime -lt $qa7Start -or ($qa7Directory.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Owned cleanup path check failed'}
 Remove-Item -LiteralPath $qa7Path -Recurse -Force
 $qa7Removed+=$qa7Directory.Name
}
foreach($qa7Pair in @(@($env:APPDATA,'WeftMate qa7'),@($env:LOCALAPPDATA,'weftmate-qa7-updater'))){
 $qa7Parent=[IO.Path]::GetFullPath($qa7Pair[0]).TrimEnd('\')+'\';$qa7Target=[IO.Path]::GetFullPath((Join-Path $qa7Pair[0] $qa7Pair[1]))
 if(!$qa7Target.StartsWith($qa7Parent,[StringComparison]::OrdinalIgnoreCase)){throw 'QA7 application namespace outside parent'}
 if(Test-Path -LiteralPath $qa7Target){if((Get-Item -LiteralPath $qa7Target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unexpected linked QA7 namespace'};Remove-Item -LiteralPath $qa7Target -Recurse -Force;$qa7Removed+=$qa7Pair[1]}
}
$qa7Packages=& D:/Software/MuMuPlayer/nx_main/adb.exe -s 127.0.0.1:7555 shell pm list packages com.memoweft.weftmate.mobile.and1
$qa7Remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $qa7Start -and $_.ExecutablePath -match '(node|electron|python|WeftMate(?:-Setup-[^\\]+)?)\.exe$' -and $_.CommandLine -match $qa7Scope })
@{extraStopped=$qa7Stopped;totalManuallyCleanedProcesses=(1+$qa7Stopped.Count);initialFixtureCleanup='initial-fixture-process-cleanup.json';removedOwnedDirectories=$qa7Removed;remainingOwnedProcesses=$qa7Remaining.Count;androidPackageAbsent=![bool]$qa7Packages;emulatorStartedByThisTask=$false;existingMuMuLeftRunning=$true;privateCopiesRemaining=@(Get-ChildItem -LiteralPath $qa7Temp -Directory -Filter 'weftmate-qa7-migration-*').Count;signingKeysRemaining=@(Get-ChildItem -LiteralPath $qa7Temp -Directory -Filter 'weftmate-qa7-signing-*').Count;finishedAt=(Get-Date -Format o)} | ConvertTo-Json -Depth 5 | Set-Content tests/evidence/qa-7/cleanup.json
Remove-Item -LiteralPath .local/qa-7/migration-private.log -Force
if((Get-Item tests/evidence/qa-7/baseline-windows-failure.log).Length -eq 0){Remove-Item -LiteralPath tests/evidence/qa-7/baseline-windows-failure.log}
