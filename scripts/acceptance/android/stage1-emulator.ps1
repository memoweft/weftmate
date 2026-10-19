param(
  [Parameter(Mandatory)][string]$Evidence,
  [Parameter(Mandatory)][string]$Locks,
  [Parameter(Mandatory)][string]$Manager,
  [Parameter(Mandatory)][string]$Adb,
  [int]$Instance=-1,
  [switch]$Uninstall
)
$ErrorActionPreference='Stop'
$package='com.memoweft.weftmate.mobile.b2qa'
$owner='R-B2 MuMu '+[DateTimeOffset]::UtcNow.ToString('o')
$owned=@();$serial=$null;$launched=$false;$instrument=$null;$packagesAbsent=$null
try {
  $lock=Join-Path $Locks 'mumu.lock'
  New-Item -ItemType File -Path $lock -Value $owner -ErrorAction Stop|Out-Null;$owned+=$lock
  foreach($n in 1..3){$p=Join-Path $Locks "heavy-$n.lock";try{New-Item -ItemType File -Path $p -Value $owner -ErrorAction Stop|Out-Null;$owned+=$p;break}catch [IO.IOException]{}}
  if($owned.Count -ne 2){throw 'No heavy slot'}
  if($Instance -lt 0){
    & $Manager info -v all|Set-Content (Join-Path $Evidence 'mumu-before.json')
    $created=& $Manager create -n 1 -ver 15
    $created|Set-Content (Join-Path $Evidence 'mumu-created.json')
    $before=Get-Content (Join-Path $Evidence 'mumu-before.json') -Raw|ConvertFrom-Json -AsHashtable
    $after=& $Manager info -v all|ConvertFrom-Json -AsHashtable
    $new=@($after.Keys|Where-Object{!$before.ContainsKey($_)})
    if($new.Count -ne 1){throw 'Cannot establish the new instance identity'}
    $Instance=[int]$new[0]
    $Instance|Set-Content (Join-Path $Evidence 'instance.txt')
  }
  if($Instance -le 1){throw 'Refusing existing primary instances'}
  $info=& $Manager info -v $Instance|ConvertFrom-Json
  if($info.is_process_started){throw 'Instance already running'}
  & $Manager control -v $Instance launch|Out-Null;$launched=$true
  & $Manager control -v $Instance hide_window|Out-Null
  $deadline=[DateTimeOffset]::UtcNow.AddMinutes(18)
  do{Start-Sleep 2;$info=& $Manager info -v $Instance|ConvertFrom-Json}until(($info.is_android_started -and $info.adb_port) -or [DateTimeOffset]::UtcNow -gt $deadline.AddMinutes(-15))
  if(!$info.is_android_started){throw 'Boot timeout'}
  $info|ConvertTo-Json -Depth 6|Set-Content (Join-Path $Evidence 'mumu-active.json')
  $serial='127.0.0.1:'+$info.adb_port
  & $Adb connect $serial|Out-Null
  & $Adb -s $serial shell getprop ro.build.version.release|Set-Content (Join-Path $Evidence 'android-version.txt')
  $existing=& $Adb -s $serial shell pm list packages $package
  if(!$existing){
    $existing|Set-Content (Join-Path $Evidence 'fresh-before.txt')
  }
  # Always install this batch's candidate, including when reusing an instance. -r retains data.
  foreach($apk in @('baseline','driver')){
    $installed=& $Adb -s $serial install -r (Join-Path $Evidence "$apk.apk")
    $installExit=$LASTEXITCODE
    $installed|Set-Content (Join-Path $Evidence "install-$apk.txt")
    if($installExit -ne 0 -or ($installed|Out-String) -notmatch '(?m)^Success\s*$'){throw "Candidate installation failed: $apk"}
  }
  & $Adb -s $serial shell am force-stop $package|Out-Null
  & $Adb -s $serial shell run-as $package rm -f files/b2-driver-port|Out-Null
  $instrument=Start-Process -FilePath $Adb -ArgumentList @('-s',$serial,'shell','am','instrument','-w','-r','-e','class','com.memoweft.weftmate.mobile.Stage1Driver',"$package.test/androidx.test.runner.AndroidJUnitRunner") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Evidence 'instrument.txt') -RedirectStandardError (Join-Path $Evidence 'instrument-error.txt')
  $port=$null
  foreach($attempt in 1..40){Start-Sleep 1;$port=& $Adb -s $serial shell run-as $package cat files/b2-driver-port 2>$null;if($port -match '^\d+$'){break}}
  if($port -notmatch '^\d+$'){throw 'Driver port unavailable'}
  $forward=& $Adb -s $serial forward tcp:0 "tcp:$port"
  @{instance=$Instance;serial=$serial;forwardPort=[int]$forward;deadline=$deadline.ToString('o');package=$package}|ConvertTo-Json|Set-Content (Join-Path $Evidence 'session.json')
  while([DateTimeOffset]::UtcNow -lt $deadline -and !(Test-Path (Join-Path $Evidence 'stop-session')) -and !$instrument.HasExited){Start-Sleep 2}
} finally {
  if($serial){
    & $Adb -s $serial shell am force-stop $package|Out-Null
    if($forward){& $Adb -s $serial forward --remove "tcp:$forward"|Out-Null}
    if($Uninstall){& $Adb -s $serial uninstall "$package.test"|Set-Content (Join-Path $Evidence 'uninstall-driver.txt');& $Adb -s $serial uninstall $package|Set-Content (Join-Path $Evidence 'uninstall.txt');$remaining=& $Adb -s $serial shell pm list packages $package;$remaining|Set-Content (Join-Path $Evidence 'fresh-after.txt');$packagesAbsent=($LASTEXITCODE -eq 0 -and [string]::IsNullOrWhiteSpace(($remaining|Out-String)))}
    & $Adb disconnect $serial|Out-Null
  }
  if($instrument -and !$instrument.HasExited){$instrument.Kill($true)}
  if($launched){& $Manager control -v $Instance shutdown|Set-Content (Join-Path $Evidence 'shutdown.txt')}
  foreach($p in $owned){if((Get-Content $p -Raw).Trim() -eq $owner){Remove-Item -LiteralPath $p}}
  @{finished=[DateTimeOffset]::UtcNow.ToString('o');instance=$Instance;launched=$launched;uninstallRequested=[bool]$Uninstall;packagesAbsent=$packagesAbsent;locksReleased=(@($owned|Where-Object{Test-Path $_}).Count -eq 0)}|ConvertTo-Json|Set-Content (Join-Path $Evidence 'session-cleanup.json')
}
